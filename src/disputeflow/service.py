"""Coordinator: persisted jobs, bounded correction, governance and execution journal."""

import asyncio
import hashlib
import logging
import re
from datetime import UTC, datetime, timedelta
from typing import Any

from pydantic import ValidationError
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
    CaseInput,
    EvidenceUpdate,
    EvidenceVerificationInput,
    PolicyDocument,
    ReviewInput,
)
from .governance import evaluate
from .llm import ExtractionError, build_extractor, validate_grounding
from .paypal import PayPalClient, PayPalError, normalized_case, validate_action_payload
from .policy import PolicyCatalog
from .reasoning import UnsupportedTheoryError, solve

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


async def analyze(case: CaseInput, catalog: PolicyCatalog, extractor, settings: Settings) -> dict:
    retrieval = await catalog.retrieve(case, extractor)
    previous = None
    diagnostics = None
    attempts: list[dict] = []
    for index in range(settings.max_repair_attempts + 1):
        try:
            knowledge = await extractor.extract(
                case, retrieval, previous=previous, diagnostics=diagnostics
            )
            validate_grounding(knowledge, case, retrieval)
            if previous:
                verified_ids = {e.id for e in case.evidence if e.verified}
                required = {
                    f.literal.key()
                    for f in previous.facts
                    if f.evidence_ids and set(f.evidence_ids) <= verified_ids
                }
                current = {f.literal.key() for f in knowledge.facts}
                if not required <= current:
                    raise ExtractionError("Correction removed a fact backed by verified evidence")
        except ExtractionError as exc:
            diagnostics = [str(exc)]
            attempts.append(
                {"attempt": index, "status": "invalid_extraction", "diagnostics": diagnostics}
            )
            if index == settings.max_repair_attempts:
                return {
                    "retrieval": retrieval.model_dump(mode="json"),
                    "attempts": attempts,
                    "knowledge_base": None,
                    "solver": None,
                    "governance": {
                        "recommended_action": None,
                        "confidence": 0,
                        "requires_human": True,
                        "reasons": ["Grounded extraction failed"],
                        "components": {},
                    },
                    "agents": ["stair", "extractor", "self_correction", "governance"],
                }
            continue
        try:
            result = await asyncio.to_thread(
                solve,
                knowledge,
                max_models=settings.solver_max_models,
                timeout_seconds=settings.solver_timeout_seconds,
            )
        except UnsupportedTheoryError as exc:
            # A solver language limitation is not evidence to rewrite a policy.
            diagnostics = [str(exc)]
            attempts.append(
                {
                    "attempt": index,
                    "status": "unsupported_formalization",
                    "knowledge_base": knowledge.model_dump(mode="json"),
                    "diagnostics": diagnostics,
                }
            )
            return {
                "retrieval": retrieval.model_dump(mode="json"),
                "knowledge_base": knowledge.model_dump(mode="json"),
                "solver": None,
                "attempts": attempts,
                "governance": {
                    "recommended_action": None,
                    "confidence": 0,
                    "requires_human": True,
                    "reasons": ["Unsupported rule formalization", *diagnostics],
                    "components": {},
                },
                "agents": ["stair", "extractor", "asp_compiler", "governance"],
            }
        attempts.append(
            {
                "attempt": index,
                "status": result.status,
                "knowledge_base": knowledge.model_dump(mode="json"),
                "program_sha256": result.program_sha256,
                "diagnostics": result.diagnostics,
            }
        )
        if result.status != "inconsistent" or index == settings.max_repair_attempts:
            governance = evaluate(case, knowledge, retrieval, result, settings)
            return {
                "retrieval": retrieval.model_dump(mode="json"),
                "knowledge_base": knowledge.model_dump(mode="json"),
                "solver": result.model_dump(mode="json"),
                "governance": governance.model_dump(mode="json"),
                "attempts": attempts,
                "agents": ["stair", "extractor", "asp_compiler", "clingo", "governance"],
            }
        previous = knowledge
        diagnostics = result.diagnostics or [
            "No stable model: examine contradictory facts and rules. Do not discard verified facts."
        ]
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
                if existing.sha256 != digest(data):
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
            if case.origin == "paypal" and any(
                e.id.startswith("paypal_") for e in changes.evidence
            ):
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
        try:
            self.reload_policies()
            result = await asyncio.wait_for(
                analyze(data, self.catalog, self.extractor, self.settings),
                timeout=self.settings.analysis_timeout_seconds,
            )
        except Exception:
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
                    if case.latest_run_id == run.id:
                        case.status = "review_required"
                    audit(session, case, "analysis_failed", {"run_id": run_id, "error": run.error})
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
                operator_evidence = [e for e in old.evidence if not e.id.startswith("paypal_")]
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
