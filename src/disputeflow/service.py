"""Coordinator: persisted jobs, bounded correction, governance and execution journal."""

import asyncio
import hashlib
import logging
import re
from datetime import UTC, datetime, timedelta
from time import perf_counter
from typing import Any

from pydantic import BaseModel, ValidationError
from sqlalchemy import and_, or_, select, update

from .config import Settings
from .db import (
    CaseRecord,
    Database,
    ExecutionRecord,
    PolicyRecord,
    ReviewRecord,
    RunRecord,
    WebhookRecord,
    audit,
    canonical,
    now,
    uid,
)
from .domain import (
    Action,
    AnalysisAttempt,
    AnalysisResult,
    AnalysisStep,
    CaseInput,
    EvidenceUpdate,
    EvidenceVerificationInput,
    ExtractionInput,
    ExtractionOutput,
    GovernanceControls,
    GovernanceInput,
    GovernanceOutput,
    GovernanceResult,
    PolicyDocument,
    PolicyRetrievalInput,
    PolicyRetrievalOutput,
    ReasoningInput,
    ReasoningOutput,
    ReviewInput,
    VerificationInput,
    VerificationOutput,
)
from .governance import evaluate
from .llm import ExtractionError, build_extractor
from .paypal import PayPalClient, PayPalError, normalized_case, validate_action_payload
from .policy import PolicyCatalog
from .reasoning import solve
from .verification import (
    VerificationError,
    contract_hash,
    verify_governance,
    verify_knowledge,
    verify_reasoning,
    verify_retrieval,
)

logger = logging.getLogger(__name__)


class ServiceError(ValueError):
    def __init__(self, status: int, detail: str):
        self.status = status
        self.detail = detail
        super().__init__(detail)


def record_dict(record) -> dict[str, Any]:
    """Serialize public columns with UTC timestamps consistently across databases."""
    result = {}
    for column in record.__table__.columns:
        if column.name in {"lease_owner", "lease_until", "audit_hash", "audit_seq"}:
            continue
        value = getattr(record, column.name)
        if isinstance(value, datetime):
            # Application timestamps are UTC. SQLite drops timezone information
            # on reload; retaining explicit UTC avoids a browser treating them as local.
            value = value.replace(tzinfo=UTC) if value.tzinfo is None else value.astimezone(UTC)
        result[column.name] = value
    return result


def digest(value: Any) -> str:
    return hashlib.sha256(canonical(value).encode()).hexdigest()


class AnalysisFailure(RuntimeError):
    """Safe failure with independently validated stage evidence for persistence."""

    def __init__(self, result: AnalysisResult):
        self.result = result
        super().__init__("A component failed its validated analysis contract")


class AnalysisCancelled(asyncio.CancelledError):
    def __init__(self, result: AnalysisResult):
        self.result = result
        super().__init__("Analysis stage was cancelled or timed out")


class _StageFailure(ValueError):
    def __init__(self, code: str, message: str):
        self.code = code
        super().__init__(message)


def _boundary_output(value, model, payload_field):
    # Never trust BaseModel instances: producers can mutate or model_construct them.
    raw = value.model_dump(mode="json", warnings=False) if isinstance(value, BaseModel) else value
    if not isinstance(raw, dict) or payload_field not in raw:
        raw = {payload_field: raw}
    return model.model_validate(raw)


def _held_result(retrieval, attempts, trace, *, knowledge=None, solver=None) -> AnalysisResult:
    return AnalysisResult(
        retrieval=retrieval,
        knowledge_base=knowledge,
        solver=solver,
        governance=GovernanceResult(
            recommended_action=None,
            confidence=0,
            requires_human=True,
            reasons=["Grounded extraction or component contract verification failed"],
            components={},
        ),
        attempts=attempts,
        agents=["stair", "extractor", "independent_verifier", "governance"],
        stage_trace=trace,
    )


async def _stage(
    request,
    operation,
    output_model,
    payload_field,
    trace,
    *,
    attempt=0,
    mode="deterministic",
    verifier=None,
):
    started_at, started = now(), perf_counter()
    input_hash = contract_hash(request)
    output = None
    failure = None
    try:
        raw = await operation()
        output = _boundary_output(raw, output_model, payload_field)
        if verifier:
            verifier(output)
    except asyncio.CancelledError:
        failure = _StageFailure("stage_timeout", "Analysis stage was cancelled or timed out")
        raise
    except Exception as exc:
        if isinstance(exc, VerificationError):
            failure = _StageFailure(exc.code, str(exc))
        elif isinstance(exc, ValidationError):
            failure = _StageFailure(
                "invalid_contract", "Producer output failed its versioned schema contract"
            )
        elif isinstance(exc, ExtractionError):
            failure = _StageFailure(
                "extraction_failed",
                "Extractor failed to return a valid source-grounded knowledge base",
            )
        else:
            failure = _StageFailure(
                "component_failed", "Component failed; inspect provider or policy configuration"
            )
        # Do not retain upstream/validation payloads in exception chains or logs.
        raise failure from None
    finally:
        trace.append(
            AnalysisStep(
                component=request.component,
                mode=mode,
                attempt=attempt,
                status="rejected"
                if failure and request.component in {"extraction", "verification"}
                else "failed"
                if failure
                else "succeeded",
                decision="reject" if failure else "continue",
                started_at=started_at,
                finished_at=now(),
                duration_ms=(perf_counter() - started) * 1000,
                input_sha256=input_hash,
                output_sha256=contract_hash(output) if output and not failure else None,
                error_code=failure.code if failure else None,
                diagnostics=[str(failure)] if failure else [],
                input_ref="run.input_snapshot+immutable_policy+result.attempts",
                output_ref=(
                    "result.retrieval"
                    if request.component == "policy_retrieval"
                    else f"result.attempts[{attempt}].knowledge_base"
                    if request.component == "extraction"
                    else "stage.verification"
                    if request.component == "verification"
                    else f"result.attempts[{attempt}].solver_or_result_solver"
                    if request.component == "asp_reasoning"
                    else "result.governance"
                )
                if not failure
                else None,
                verification=output.verification
                if output and not failure and request.component == "verification"
                else None,
                max_clauses=request.max_clauses
                if request.component == "policy_retrieval"
                else None,
                max_models=request.max_models if request.component == "asp_reasoning" else None,
                timeout_seconds=request.timeout_seconds
                if request.component == "asp_reasoning"
                else None,
                governance_controls=request.controls if request.component == "governance" else None,
            )
        )
    return output


async def analyze(
    case: CaseInput, catalog: PolicyCatalog, extractor, settings: Settings, *, stage_trace=None
) -> dict:
    trace: list[AnalysisStep] = stage_trace if stage_trace is not None else []
    attempts: list[AnalysisAttempt] = []
    retrieval = None
    previous = None
    diagnostics = None
    active_knowledge = None
    extracted_knowledge = None
    active_solver = None
    index = 0

    def failure_result():
        if extracted_knowledge is not None and not any(item.attempt == index for item in attempts):
            attempts.append(
                AnalysisAttempt(
                    attempt=index,
                    status="component_failed",
                    knowledge_base=extracted_knowledge,
                    decision="reject",
                )
            )
        return _held_result(
            retrieval, attempts, trace, knowledge=active_knowledge, solver=active_solver
        )

    mode = "deterministic" if getattr(extractor, "provider", None) == "demo" else "probabilistic"
    try:
        case = CaseInput.model_validate(case.model_dump(mode="json"))
        request = PolicyRetrievalInput(
            case=case, policy=catalog.get(case.policy_id), max_clauses=catalog.max_clauses
        )
        output = await _stage(
            request,
            lambda: catalog.retrieve(request.case.model_copy(deep=True), extractor),
            PolicyRetrievalOutput,
            "retrieval",
            trace,
            mode=mode,
            verifier=lambda value: verify_retrieval(value.retrieval, request.policy),
        )
        retrieval = output.retrieval
        for index in range(settings.max_repair_attempts + 1):
            knowledge = None
            extracted_knowledge = None
            try:
                request = ExtractionInput(
                    case=case, retrieval=retrieval, previous=previous, diagnostics=diagnostics or []
                )
                safe_input = request.model_copy(deep=True)
                output = await _stage(
                    request,
                    lambda safe_input=safe_input: extractor.extract(
                        safe_input.case,
                        safe_input.retrieval,
                        previous=safe_input.previous,
                        diagnostics=safe_input.diagnostics or None,
                    ),
                    ExtractionOutput,
                    "knowledge_base",
                    trace,
                    attempt=index,
                    mode=mode,
                )
                knowledge = output.knowledge_base
                extracted_knowledge = knowledge
                verification = VerificationInput(
                    case=case, retrieval=retrieval, knowledge_base=knowledge, previous=previous
                )

                async def verify(verification=verification):
                    return verify_knowledge(verification)

                await _stage(
                    verification, verify, VerificationOutput, "verification", trace, attempt=index
                )
                active_knowledge = knowledge
            except _StageFailure as exc:
                diagnostics = [str(exc)]
                decision = "reject" if index == settings.max_repair_attempts else "repair"
                trace[-1].decision = decision
                attempts.append(
                    AnalysisAttempt(
                        attempt=index,
                        status="invalid_extraction",
                        knowledge_base=knowledge,
                        diagnostics=diagnostics,
                        decision=decision,
                    )
                )
                if index == settings.max_repair_attempts:
                    return _held_result(retrieval, attempts, trace).model_dump(mode="json")
                continue
            request = ReasoningInput(
                knowledge_base=knowledge,
                authoritative_vocabulary=retrieval.authoritative_vocabulary,
                max_models=settings.solver_max_models,
                timeout_seconds=settings.solver_timeout_seconds,
            )
            output = await _stage(
                request,
                lambda request=request: asyncio.to_thread(
                    solve,
                    request.knowledge_base.model_copy(deep=True),
                    max_models=request.max_models,
                    timeout_seconds=request.timeout_seconds,
                    authoritative_vocabulary=request.authoritative_vocabulary,
                ),
                ReasoningOutput,
                "solver",
                trace,
                attempt=index,
                verifier=lambda value, request=request: verify_reasoning(request, value.solver),
            )
            result = output.solver
            active_solver = result
            decision = (
                "repair"
                if result.status == "inconsistent" and index < settings.max_repair_attempts
                else "return"
            )
            trace[-1].decision = decision
            attempts.append(
                AnalysisAttempt(
                    attempt=index,
                    status=result.status,
                    knowledge_base=knowledge,
                    program_sha256=result.program_sha256,
                    solver=result if decision == "repair" else None,
                    diagnostics=result.diagnostics,
                    decision=decision,
                )
            )
            if decision == "return":
                request = GovernanceInput(
                    case=case,
                    knowledge_base=knowledge,
                    retrieval=retrieval,
                    solver=result,
                    controls=GovernanceControls(
                        auto_confidence_threshold=settings.auto_confidence_threshold,
                        auto_max_amount=settings.auto_max_amount,
                        auto_currency=settings.auto_currency,
                    ),
                )

                async def govern(request=request):
                    safe = request.model_copy(deep=True)
                    controls = settings.model_copy(update=safe.controls.model_dump())
                    return evaluate(
                        safe.case,
                        safe.knowledge_base,
                        safe.retrieval,
                        safe.solver,
                        controls,
                    )

                output = await _stage(
                    request,
                    govern,
                    GovernanceOutput,
                    "governance",
                    trace,
                    attempt=index,
                    verifier=lambda value, request=request: verify_governance(
                        request, value.governance
                    ),
                )
                trace[-1].decision = (
                    "human_review" if output.governance.requires_human else "eligible_for_execution"
                )
                return AnalysisResult(
                    retrieval=retrieval,
                    knowledge_base=knowledge,
                    solver=result,
                    governance=output.governance,
                    attempts=attempts,
                    agents=[
                        "stair",
                        "extractor",
                        "independent_verifier",
                        "asp_compiler",
                        "clingo",
                        "governance",
                    ],
                    stage_trace=trace,
                ).model_dump(mode="json")
            previous = knowledge
            diagnostics = result.diagnostics or [
                "No stable model: examine contradictory facts and rules. Do not discard verified facts."
            ]
    except asyncio.CancelledError:
        raise AnalysisCancelled(failure_result()) from None
    except AnalysisFailure:
        raise
    except Exception:
        raise AnalysisFailure(failure_result()) from None
    raise RuntimeError("Unreachable analysis state")


class Coordinator:
    def __init__(self, settings: Settings, database: Database, *, extractor=None, paypal=None):
        self.settings = settings
        self.db = database
        self.catalog = PolicyCatalog(
            settings.policy_dir, max_clauses=settings.retrieval_max_clauses
        )
        self.extractor = extractor or build_extractor(settings)
        self.paypal = paypal or PayPalClient(settings)

    async def close(self):
        await self.paypal.close()
        close = getattr(self.extractor, "close", None)
        if close:
            await close()

    def reload_policies(self):
        catalog = PolicyCatalog(
            self.settings.policy_dir, max_clauses=self.settings.retrieval_max_clauses
        )
        with self.db.sessions() as session:
            for record in session.scalars(select(PolicyRecord)):
                if record.sha256 != digest(record.document):
                    raise ServiceError(503, "Stored policy integrity check failed")
                catalog.register_document(PolicyDocument.model_validate(record.document))
        self.catalog = catalog

    def import_policy(self, document: PolicyDocument) -> PolicyDocument:
        self.reload_policies()
        # Registration validates immutability against bundled and database documents.
        approved = self.catalog.register_document(document)
        data = approved.model_dump(mode="json")
        with self.db.sessions.begin() as session:
            existing = session.get(PolicyRecord, document.id)
            if existing:
                if existing.sha256 != digest(existing.document):
                    raise ServiceError(503, "Stored policy integrity check failed")
                normalized = PolicyDocument.model_validate(existing.document).model_dump(
                    mode="json"
                )
                if digest(normalized) != digest(data):
                    raise ServiceError(
                        409, "Policy ID already identifies different immutable content"
                    )
            else:
                session.add(PolicyRecord(id=document.id, document=data, sha256=digest(data)))
        return approved

    @staticmethod
    def _case(session, case_id: str, *, lock=False) -> CaseRecord:
        query = select(CaseRecord).where(CaseRecord.id == case_id)
        if lock:
            query = query.with_for_update()
        case = session.scalar(query)
        if not case:
            raise ServiceError(404, "Dispute not found")
        return case

    @staticmethod
    def _run(session, run_id: str, *, lock=False) -> RunRecord:
        query = select(RunRecord).where(RunRecord.id == run_id)
        if lock:
            query = query.with_for_update()
        run = session.scalar(query)
        if not run:
            raise ServiceError(404, "Run not found")
        return run

    @staticmethod
    def _mutable(case: CaseRecord):
        if case.status in {"executing", "execution_uncertain"}:
            raise ServiceError(
                409, "Reconcile the outstanding PayPal operation before changing the case"
            )

    def create_case(self, data: CaseInput) -> dict:
        self.reload_policies()
        self.catalog.get(data.policy_id)
        with self.db.sessions.begin() as session:
            if data.external_id and session.scalar(
                select(CaseRecord).where(CaseRecord.external_id == data.external_id)
            ):
                raise ServiceError(409, "External dispute ID already exists")
            case = CaseRecord(
                id=uid(),
                data=data.model_dump(mode="json"),
                external_id=data.external_id,
                audit_seq=0,
                audit_hash="0" * 64,
            )
            session.add(case)
            session.flush()
            audit(
                session,
                case,
                "case_created",
                {"version": case.version, "origin": "manual", "data_sha256": digest(case.data)},
                "service",
            )
            return record_dict(case)

    def update_evidence(self, case_id: str, changes: EvidenceUpdate) -> dict:
        with self.db.sessions.begin() as session:
            case = self._case(session, case_id, lock=True)
            self._mutable(case)
            data = CaseInput.model_validate(case.data)
            evidence = {e.id: e for e in data.evidence}
            if case.origin == "paypal" and any(e.id == "paypal_snapshot" for e in changes.evidence):
                raise ServiceError(
                    422, "Imported PayPal evidence can only be refreshed from PayPal"
                )
            evidence.update({e.id: e for e in changes.evidence})
            try:
                data = CaseInput.model_validate(
                    {
                        **data.model_dump(mode="json"),
                        "evidence": [e.model_dump(mode="json") for e in evidence.values()],
                    }
                )
            except ValidationError:
                raise ServiceError(422, "Merged case evidence exceeds contract limits") from None
            case.data = data.model_dump(mode="json")
            case.version += 1
            case.latest_run_id = None
            case.status = "open"
            audit(
                session,
                case,
                "evidence_updated",
                {
                    "version": case.version,
                    "evidence_ids": [e.id for e in changes.evidence],
                    "data_sha256": digest(case.data),
                },
                "service",
            )
            return record_dict(case)

    def verify_evidence(
        self, case_id: str, evidence_id: str, data: EvidenceVerificationInput
    ) -> dict:
        with self.db.sessions.begin() as session:
            case = self._case(session, case_id, lock=True)
            self._mutable(case)
            updated = CaseInput.model_validate(case.data)
            evidence = next((e for e in updated.evidence if e.id == evidence_id), None)
            if evidence is None:
                raise ServiceError(404, "Evidence not found")
            evidence.verified = data.verified
            case.data = updated.model_dump(mode="json")
            case.version += 1
            case.latest_run_id = None
            case.status = "open"
            audit(
                session,
                case,
                "evidence_verification",
                {
                    "version": case.version,
                    "evidence_id": evidence_id,
                    "verified": data.verified,
                    "note": data.note,
                    "data_sha256": digest(case.data),
                },
                "reviewer",
            )
            return record_dict(case)

    def enqueue(self, case_id: str, execute=False) -> dict:
        with self.db.sessions.begin() as session:
            case = self._case(session, case_id, lock=True)
            self._mutable(case)
            if case.status in {"resolved", "executed"}:
                raise ServiceError(
                    409, "This version has already been resolved or received an external response"
                )
            if case.latest_run_id:
                active = session.get(RunRecord, case.latest_run_id)
                if (
                    active
                    and active.status in {"queued", "running"}
                    and active.case_version == case.version
                ):
                    if active.execute_requested != execute:
                        raise ServiceError(
                            409, "An active run already has a different execution request"
                        )
                    return record_dict(active)
            run = RunRecord(
                id=uid(),
                case_id=case.id,
                case_version=case.version,
                input_snapshot=case.data,
                execute_requested=execute,
            )
            session.add(run)
            session.flush()
            case.latest_run_id = run.id
            case.status = "analyzing"
            audit(
                session,
                case,
                "analysis_queued",
                {"run_id": run.id, "version": case.version, "execute_requested": execute},
                "service",
            )
            return record_dict(run)

    def _claim(self, model) -> tuple[str, str] | None:
        owner = uid()
        due = now()
        eligible = or_(
            model.status == "queued", and_(model.status == "running", model.lease_until < due)
        )
        with self.db.sessions.begin() as session:
            candidate = session.scalar(
                select(model.id).where(eligible).order_by(model.created_at).limit(1)
            )
            if not candidate:
                return None
            result = session.execute(
                update(model)
                .where(model.id == candidate, eligible)
                .values(
                    status="running",
                    lease_owner=owner,
                    lease_until=due + timedelta(seconds=self.settings.job_lease_seconds),
                )
            )
            if result.rowcount != 1:
                return None
        return candidate, owner

    async def process_one(self) -> bool:
        # Renewed webhook reads are safe to repeat; external writes use a separate journal.
        webhook = self._claim(WebhookRecord)
        if webhook:
            await self._process_webhook(*webhook)
            return True
        claimed = self._claim(RunRecord)
        if not claimed:
            return False
        run_id, owner = claimed
        with self.db.sessions.begin() as session:
            run = self._run(session, run_id)
            case = self._case(session, run.case_id, lock=True)
            if run.case_version != case.version or case.latest_run_id != run.id:
                run.status = "stale"
                run.finished_at = now()
                audit(session, case, "analysis_stale", {"run_id": run_id})
                return True
            data = CaseInput.model_validate(run.input_snapshot)
            audit(session, case, "analysis_started", {"run_id": run_id})
        stage_trace: list[AnalysisStep] = []
        try:
            self.reload_policies()
            result = await asyncio.wait_for(
                analyze(data, self.catalog, self.extractor, self.settings, stage_trace=stage_trace),
                timeout=self.settings.analysis_timeout_seconds,
            )
        except Exception as exc:
            logger.exception("Analysis failed for run %s", run_id)
            with self.db.sessions.begin() as session:
                run = self._run(session, run_id, lock=True)
                case = self._case(session, run.case_id, lock=True)
                if run.lease_owner == owner and run.status == "running":
                    run.status = "failed"
                    run.error = (
                        "Analysis failed; inspect server logs and policy/provider configuration"
                    )
                    run.finished_at = now()
                    failure = getattr(exc, "result", None) or getattr(exc.__cause__, "result", None)
                    if not isinstance(failure, AnalysisResult):
                        failure = _held_result(None, [], stage_trace)
                    run.result = failure.model_dump(mode="json")
                    if case.latest_run_id == run.id:
                        case.status = "review_required"
                    self._audit_stages(session, case, run_id, run.result)
                    audit(
                        session,
                        case,
                        "analysis_failed",
                        {"run_id": run_id, "error": run.error, "result_sha256": digest(run.result)},
                    )
            return True
        with self.db.sessions.begin() as session:
            run = self._run(session, run_id, lock=True)
            case = self._case(session, run.case_id, lock=True)
            if run.lease_owner != owner or run.status != "running":
                return True
            run.result = result
            run.finished_at = now()
            stale = run.case_version != case.version or case.latest_run_id != run.id
            run.status = "stale" if stale else "completed"
            if not stale:
                case.status = (
                    "review_required" if result["governance"]["requires_human"] else "ready"
                )
            self._audit_stages(session, case, run_id, result)
            audit(
                session,
                case,
                "analysis_stale" if stale else "analysis_completed",
                {
                    "run_id": run_id,
                    "confidence": result["governance"]["confidence"],
                    "result_sha256": digest(result),
                    "solver_status": result["solver"]["status"]
                    if result["solver"]
                    else "extraction_failed",
                },
            )
            auto = (
                not stale
                and run.execute_requested
                and data.auto_execute
                and not result["governance"]["requires_human"]
            )
        if auto:
            try:
                await self.execute(run_id, {}, f"auto-{run_id}", automatic=True)
            except (ServiceError, PayPalError):
                logger.info("Automatic execution could not proceed for %s; review required", run_id)
                with self.db.sessions.begin() as session:
                    run = self._run(session, run_id)
                    case = self._case(session, run.case_id, lock=True)
                    if case.latest_run_id == run_id and case.status == "ready":
                        case.status = "review_required"
                        audit(session, case, "automatic_execution_deferred", {"run_id": run_id})
        return True

    @staticmethod
    def _audit_stages(session, case, run_id, result):
        for index, step in enumerate(result.get("stage_trace", [])):
            audit(
                session,
                case,
                "analysis_stage",
                {"run_id": run_id, "step_index": index, "step": step},
                "orchestrator",
            )

    def review(self, run_id: str, data: ReviewInput) -> dict:
        with self.db.sessions.begin() as session:
            run = self._run(session, run_id)
            case = self._case(session, run.case_id, lock=True)
            self._mutable(case)
            self._current(case, run)
            if session.scalar(select(ReviewRecord).where(ReviewRecord.run_id == run.id)):
                raise ServiceError(
                    409, "Run already reviewed; create a new analysis for another review"
                )
            if (
                data.action != Action.NO_ACTION
                and data.action not in CaseInput.model_validate(case.data).allowed_actions
            ):
                raise ServiceError(422, "Requested action is not allowed for this case")
            review = ReviewRecord(
                id=uid(), run_id=run.id, action=data.action.value, note=data.note, actor="reviewer"
            )
            session.add(review)
            session.flush()
            case.status = "reviewed" if data.action != Action.NO_ACTION else "held"
            audit(
                session,
                case,
                "human_review",
                {"run_id": run_id, "action": data.action.value, "note": data.note},
                "reviewer",
            )
            return record_dict(review)

    @staticmethod
    def _current(case: CaseRecord, run: RunRecord):
        if run.status != "completed" or not run.result:
            raise ServiceError(409, "Analysis must be completed before review or execution")
        if run.case_version != case.version or case.latest_run_id != run.id:
            raise ServiceError(409, "Run is stale; analyze the current evidence version")

    @staticmethod
    def _payload(action: Action, supplied: dict, run_id: str) -> dict:
        if supplied:
            return validate_action_payload(action, supplied)
        note = f"DisputeFlow reviewed response. Audit reference {run_id}."
        if action in {Action.ACCEPT_CLAIM, Action.ESCALATE}:
            return validate_action_payload(action, {"note": note})
        # Do not manufacture evidence content, offers or messages from an audit reference.
        raise ServiceError(422, "This action requires an explicit, reviewed PayPal payload")

    async def execute(self, run_id: str, payload: dict, key: str, *, automatic=False) -> dict:
        if not re.fullmatch(r"[A-Za-z0-9_.:-]{1,128}", key):
            raise ServiceError(422, "Idempotency-Key must contain 1-128 safe ASCII characters")
        mode = self.settings.execution_mode
        request_hash = hashlib.sha256(
            canonical({"run_id": run_id, "payload": payload, "mode": mode}).encode()
        ).hexdigest()
        with self.db.sessions.begin() as session:
            existing = session.scalar(
                select(ExecutionRecord).where(ExecutionRecord.idempotency_key == key)
            )
            if existing:
                if existing.request_hash != request_hash:
                    raise ServiceError(409, "Idempotency key was used for a different request")
                return record_dict(existing)
            run = self._run(session, run_id)
            case = self._case(session, run.case_id, lock=True)
            self._mutable(case)
            self._current(case, run)
            if case.status in {"executed", "resolved"}:
                raise ServiceError(409, "This version already has an external response")
            completed_write = session.scalar(
                select(ExecutionRecord.id)
                .join(RunRecord)
                .where(
                    RunRecord.case_id == case.id,
                    RunRecord.case_version == case.version,
                    ExecutionRecord.mode != "dry_run",
                    ExecutionRecord.status == "succeeded",
                )
            )
            if completed_write:
                raise ServiceError(409, "This version already has a successful external execution")
            prior = session.scalar(
                select(ExecutionRecord).where(
                    ExecutionRecord.run_id == run_id, ExecutionRecord.mode == mode
                )
            )
            if prior:
                raise ServiceError(
                    409, "Run already has an execution attempt in this mode; inspect its journal"
                )
            review = session.scalar(select(ReviewRecord).where(ReviewRecord.run_id == run_id))
            governance = run.result["governance"]
            if automatic and (governance["requires_human"] or not case.data.get("auto_execute")):
                raise ServiceError(409, "Automatic execution is not authorized by governance")
            if governance["requires_human"] and not review:
                raise ServiceError(409, "A reviewer must approve this decision before execution")
            action_value = review.action if review else governance["recommended_action"]
            if not action_value or action_value == Action.NO_ACTION.value:
                raise ServiceError(409, "No executable response has been approved")
            action = Action(action_value)
            if action not in CaseInput.model_validate(case.data).allowed_actions:
                raise ServiceError(409, "Approved action is no longer available")
            if mode != "dry_run":
                if case.origin != "paypal" or not case.external_id:
                    raise ServiceError(409, "Real execution requires a PayPal-imported dispute")
                if run.result["retrieval"]["synthetic"]:
                    raise ServiceError(
                        409, "Synthetic policy cannot authorize a real PayPal action"
                    )
                import json

                provider_evidence = next(
                    (e for e in case.data["evidence"] if e["id"] == "paypal_snapshot"), None
                )
                if not provider_evidence:
                    raise ServiceError(409, "Missing imported PayPal snapshot")
                expected_snapshot_hash = digest(json.loads(provider_evidence["content"]))
            outgoing = self._payload(action, payload, run_id)
            execution = ExecutionRecord(
                id=uid(),
                run_id=run_id,
                idempotency_key=key,
                request_hash=request_hash,
                action=action.value,
                mode=mode,
                payload=outgoing,
            )
            session.add(execution)
            session.flush()
            if mode != "dry_run":
                case.status = "executing"
            audit(
                session,
                case,
                "execution_intent",
                {
                    "execution_id": execution.id,
                    "run_id": run_id,
                    "action": action.value,
                    "mode": mode,
                    "payload_sha256": digest(outgoing),
                },
                "system" if automatic else "reviewer",
            )
            execution_id, external_id = execution.id, case.external_id
        try:
            if mode == "dry_run":
                response = {
                    "dry_run": True,
                    "action": action.value,
                    "payload": outgoing,
                    "external_id": external_id,
                }
            else:
                response = await asyncio.wait_for(
                    self.paypal.execute(
                        external_id,
                        action,
                        outgoing,
                        execution_id,
                        expected_snapshot_hash=expected_snapshot_hash,
                    ),
                    timeout=self.settings.execution_timeout_seconds,
                )
            status, error = "succeeded", None
        except PayPalError as exc:
            response = None
            status = "uncertain" if exc.uncertain else "failed"
            error = f"PayPal {exc.code}: {exc.message}"
        except Exception:
            logger.exception("External execution outcome unknown for %s", execution_id)
            response, status, error = (
                None,
                "uncertain",
                "Execution interrupted; check PayPal before reconciliation",
            )
        with self.db.sessions.begin() as session:
            execution = session.get(ExecutionRecord, execution_id)
            run = self._run(session, run_id)
            case = self._case(session, run.case_id, lock=True)
            session.refresh(execution)
            if execution.status != "in_flight":
                # Reconciliation is authoritative; a late completion cannot overwrite it.
                return record_dict(execution)
            execution.status, execution.error, execution.response = status, error, response
            execution.finished_at = now()
            if mode != "dry_run":
                case.status = {
                    "succeeded": "executed",
                    "uncertain": "execution_uncertain",
                    "failed": "review_required",
                }[status]
            audit(
                session,
                case,
                "execution_" + status,
                {
                    "execution_id": execution_id,
                    "mode": mode,
                    "error": error,
                    "response_sha256": digest(response),
                },
            )
            return record_dict(execution)

    def reconcile(self, execution_id: str, outcome: str, note: str) -> dict:
        with self.db.sessions.begin() as session:
            execution = session.get(ExecutionRecord, execution_id)
            if not execution:
                raise ServiceError(404, "Execution not found")
            run = self._run(session, execution.run_id)
            case = self._case(session, run.case_id, lock=True)
            session.refresh(execution)
            if execution.status not in {"uncertain", "in_flight"}:
                raise ServiceError(409, "Only outstanding executions can be reconciled")
            # A live request may still be running. Reconciliation of an interrupted intent
            # waits beyond the configured transport timeout to avoid competing updates.
            created = execution.created_at
            if created.tzinfo is None:
                from datetime import UTC

                created = created.replace(tzinfo=UTC)
            if execution.status == "in_flight" and now() - created < timedelta(
                seconds=self.settings.execution_timeout_seconds + 10
            ):
                raise ServiceError(
                    409, "Execution may still be running; wait before reconciliation"
                )
            execution.status = outcome
            execution.finished_at = now()
            execution.response = {"reconciled": True, "outcome": outcome, "note": note}
            if execution.mode != "dry_run":
                case.status = "executed" if outcome == "succeeded" else "review_required"
            audit(
                session,
                case,
                "execution_reconciled",
                {
                    "execution_id": execution.id,
                    "outcome": outcome,
                    "note": note,
                    "response_sha256": digest(execution.response),
                },
                "reviewer",
            )
            session.execute(
                update(WebhookRecord)
                .where(WebhookRecord.status == "waiting")
                .values(status="queued")
            )
            return record_dict(execution)

    async def import_paypal(self, external_id: str, policy_id: str, auto_execute=False) -> dict:
        self.reload_policies()
        self.catalog.get(policy_id)
        with self.db.sessions() as session:
            observed = session.scalar(
                select(CaseRecord).where(CaseRecord.external_id == external_id)
            )
            observed_revision = (observed.version, observed.audit_seq) if observed else None
        snapshot = await self.paypal.get_dispute(external_id)
        incoming = normalized_case(snapshot, policy_id)
        if incoming.external_id != external_id:
            raise ServiceError(502, "PayPal returned a different dispute ID")
        with self.db.sessions.begin() as session:
            case = session.scalar(
                select(CaseRecord).where(CaseRecord.external_id == external_id).with_for_update()
            )
            if case:
                self._mutable(case)
                if case.origin != "paypal":
                    raise ServiceError(409, "External ID belongs to a local case")
                if observed_revision != (case.version, case.audit_seq):
                    raise ServiceError(
                        409, "Dispute changed during import; retry with a fresh PayPal read"
                    )
                old = CaseInput.model_validate(case.data)
                previous_snapshot = next(
                    (e for e in old.evidence if e.id == "paypal_snapshot"), None
                )
                if previous_snapshot and incoming.evidence[0].content == previous_snapshot.content:
                    incoming.evidence[0].verified = previous_snapshot.verified
                operator_evidence = [e for e in old.evidence if e.id != "paypal_snapshot"]
                incoming.evidence.extend(operator_evidence)
                incoming.auto_execute = auto_execute
                new_data = incoming.model_dump(mode="json")
                if case.data == new_data:
                    return record_dict(case)
                case.data = new_data
                case.version += 1
                case.latest_run_id = None
            else:
                incoming.auto_execute = auto_execute
                case = CaseRecord(
                    id=uid(),
                    external_id=external_id,
                    data=incoming.model_dump(mode="json"),
                    origin="paypal",
                    audit_seq=0,
                    audit_hash="0" * 64,
                )
                session.add(case)
                session.flush()
            case.status = "resolved" if snapshot.get("status") == "RESOLVED" else "open"
            audit(
                session,
                case,
                "paypal_imported",
                {
                    "version": case.version,
                    "external_id": external_id,
                    "data_sha256": digest(case.data),
                },
                "service",
            )
            return record_dict(case)

    def store_webhook(self, event: dict) -> dict:
        event_id = event.get("id")
        if not isinstance(event_id, str) or not re.fullmatch(r"[A-Za-z0-9_.-]{1,128}", event_id):
            raise ServiceError(422, "Webhook requires a valid event ID")
        with self.db.sessions.begin() as session:
            existing = session.get(WebhookRecord, event_id)
            if existing:
                if canonical(existing.event) != canonical(event):
                    raise ServiceError(409, "Webhook event ID reused with different content")
                return {"id": event_id, "duplicate": True, "status": existing.status}
            supported = event.get("event_type") in {
                "CUSTOMER.DISPUTE.CREATED",
                "CUSTOMER.DISPUTE.UPDATED",
                "CUSTOMER.DISPUTE.RESOLVED",
            }
            row = WebhookRecord(
                id=event_id, event=event, status="queued" if supported else "ignored"
            )
            session.add(row)
            return {"id": event_id, "duplicate": False, "status": row.status}

    async def _process_webhook(self, event_id: str, owner: str):
        with self.db.sessions() as session:
            event = session.get(WebhookRecord, event_id).event
        try:
            external_id = event.get("resource", {}).get("dispute_id")
            if not external_id:
                raise ServiceError(422, "Dispute webhook has no dispute_id")
            # Preserve an operator's selected policy and auto mode on subsequent events.
            with self.db.sessions() as session:
                existing = session.scalar(
                    select(CaseRecord).where(CaseRecord.external_id == external_id)
                )
                policy_id = (
                    existing.data["policy_id"] if existing else self.settings.webhook_policy_id
                )
                auto_execute = existing.data.get("auto_execute", False) if existing else False
            case = await self.import_paypal(external_id, policy_id, auto_execute)
            if case["status"] != "resolved":
                self.enqueue(case["id"])
            state, error = "done", None
        except ServiceError as exc:
            # Keep updates received during an unresolved write durable and retry after reconciliation.
            state = "waiting" if exc.status == 409 and "Reconcile" in exc.detail else "failed"
            error = exc.detail
        except Exception:
            logger.exception("Webhook processing failed for %s", event_id)
            state, error = (
                "failed",
                "Webhook processing failed; check PayPal and policy configuration",
            )
        with self.db.sessions.begin() as session:
            row = session.get(WebhookRecord, event_id)
            if row.lease_owner == owner and row.status == "running":
                row.status, row.error = state, error
                row.lease_until = None
