"""Producer boundary validation, independent provenance checks and durable traces."""

import asyncio
import hashlib
import json
from pathlib import Path

import pytest
from pydantic import ValidationError

from disputeflow.config import Settings
from disputeflow.db import (
    CaseRecord,
    Database,
    PolicyRecord,
    RunRecord,
    audit_entries,
    verify_chain,
)
from disputeflow.domain import (
    Action,
    AnalysisResult,
    AnalysisStep,
    CaseInput,
    Evidence,
    EvidenceUpdate,
    EvidenceVerificationInput,
    ExtractionInput,
    ExtractionOutput,
    GovernanceInput,
    GovernanceOutput,
    PolicyRetrievalInput,
    PolicyRetrievalOutput,
    PolicySelectionInput,
    PolicySelectionOutput,
    ReasoningInput,
    ReasoningOutput,
    RetrievalResult,
    VerificationInput,
    VerificationOutput,
)
from disputeflow.llm import DemoExtractor, ExtractionError
from disputeflow.policy import PolicyCatalog, PolicyError
from disputeflow.reasoning import solve
from disputeflow.service import AnalysisFailure, Coordinator, analyze, digest
from disputeflow.verification import contract_hash, reconstruct_stage, verify_knowledge

ROOT = Path(__file__).resolve().parents[1]


def settings(**changes):
    return Settings(environment="test", policy_dir=ROOT / "policies", _env_file=None, **changes)


def example(name="unique.json"):
    return CaseInput.model_validate_json((ROOT / "examples" / name).read_text())


async def bundle():
    case = example()
    catalog = PolicyCatalog(ROOT / "policies")
    retrieval = await catalog.retrieve(case, DemoExtractor())
    knowledge = await DemoExtractor().extract(case, retrieval)
    return case, catalog, retrieval, knowledge


@pytest.mark.parametrize(
    "model",
    [
        PolicySelectionInput,
        PolicySelectionOutput,
        PolicyRetrievalInput,
        PolicyRetrievalOutput,
        ExtractionInput,
        ExtractionOutput,
        VerificationInput,
        VerificationOutput,
        ReasoningInput,
        ReasoningOutput,
        GovernanceInput,
        GovernanceOutput,
        AnalysisResult,
        AnalysisStep,
        RetrievalResult,
    ],
)
def test_all_boundary_contracts_reject_unsupported_versions(model):
    with pytest.raises(ValidationError) as exc:
        model.model_validate({"contract_version": "2.0"})
    assert any(error["loc"] == ("contract_version",) for error in exc.value.errors())


@pytest.mark.asyncio
async def test_success_trace_contains_validated_snapshots_hashes_modes_and_decision():
    result = await analyze(example(), PolicyCatalog(ROOT / "policies"), DemoExtractor(), settings())
    typed = AnalysisResult.model_validate(result)
    assert [step.component for step in typed.stage_trace] == [
        "policy_retrieval",
        "extraction",
        "verification",
        "asp_reasoning",
        "governance",
    ]
    assert all(step.mode == "deterministic" for step in typed.stage_trace)
    assert all(step.status == "succeeded" for step in typed.stage_trace)
    assert typed.stage_trace[-1].decision == "human_review"
    for step in typed.stage_trace:
        request, output = reconstruct_stage(
            step, typed, example(), PolicyCatalog(ROOT / "policies").get("demo_policy")
        )
        assert step.input_sha256 == contract_hash(request)
        assert step.output_sha256 == contract_hash(output)
        assert step.duration_ms >= 0 and step.finished_at >= step.started_at
    verified = typed.stage_trace[2].verification
    assert verified.valid and verified.checked_fact_ids
    assert verified.checked_citations > 0
    assert verified.semantic_entailment_checked is False
    assert verified.knowledge_base_sha256 == contract_hash(typed.knowledge_base)
    assert all(step.input_sha256 and step.output_sha256 for step in typed.retrieval.trace)


@pytest.mark.asyncio
async def test_old_result_and_retrieval_trace_dictionaries_remain_readable():
    result = await analyze(example(), PolicyCatalog(ROOT / "policies"), DemoExtractor(), settings())
    result.pop("contract_version")
    result.pop("stage_trace")
    result["retrieval"].pop("contract_version")
    for step in result["retrieval"]["trace"]:
        for key in list(step):
            if key not in {"path", "offered", "selected", "selector"}:
                step.pop(key)
    for attempt in result["attempts"]:
        attempt.pop("contract_version")
        attempt.pop("decision")
    decoded = AnalysisResult.model_validate(result)
    assert decoded.stage_trace == []
    assert decoded.retrieval.trace[0]["selector"] == "deterministic_demo"
    assert decoded.attempts[0].status == "unique"


@pytest.mark.asyncio
async def test_selector_mutation_cannot_change_case_paths_or_recorded_input_hash():
    captured = []

    class MutatingSelector(DemoExtractor):
        async def select_sections(self, case, headings, path):
            captured.append(
                contract_hash(PolicySelectionInput(case=case, headings=headings, path=path))
            )
            selected = await super().select_sections(case, headings, path)
            case.summary = "Producer overwrote the summary"
            path.append("Untrusted path")
            headings[0]["title"] = "Untrusted title"
            return selected

    case = example()
    original = case.model_dump(mode="json")
    retrieval = await PolicyCatalog(ROOT / "policies").retrieve(case, MutatingSelector())
    assert case.model_dump(mode="json") == original
    assert [step.input_sha256 for step in retrieval.trace] == captured
    assert all("Untrusted path" not in step.path for step in retrieval.trace)
    assert all("Untrusted path" not in clause.section_path for clause in retrieval.clauses)


@pytest.mark.asyncio
async def test_selector_unsupported_output_contract_version_is_rejected():
    class WrongVersion(DemoExtractor):
        async def select_sections(self, *args):
            return PolicySelectionOutput.model_construct(contract_version="2.0", section_ids=[])

    with pytest.raises(PolicyError, match="versioned output contract"):
        await PolicyCatalog(ROOT / "policies").retrieve(example(), WrongVersion())


class UntrustedExtractor:
    provider = "untrusted_fixture"

    def __init__(self, output, *, error=None):
        self.output, self.error = output, error
        self.extraction_calls = 0
        self.selection_calls = 0

    async def select_sections(self, case, headings, path):
        self.selection_calls += 1
        return await DemoExtractor().select_sections(case, headings, path)

    async def extract(self, case, retrieval, **kwargs):
        self.extraction_calls += 1
        if self.error:
            raise self.error
        return self.output


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("tamper", "code"),
    [
        ("reference", "evidence_reference"),
        ("quote", "citation_quote"),
        ("constructed", "invalid_contract"),
        ("version", "invalid_contract"),
        ("decision", "decision_fact"),
    ],
)
async def test_untrusted_extractor_is_checked_outside_the_producer(tamper, code):
    case, catalog, _, knowledge = await bundle()
    if tamper == "reference":
        knowledge.facts[0].evidence_ids = ["missing_evidence"]
    elif tamper == "quote":
        knowledge.rules[0].citations[0].quote = "Invented PayPal policy quotation."
    elif tamper == "constructed":
        knowledge.facts[0].literal.name = "INVALID ASP #show attack."
    elif tamper == "decision":
        knowledge.facts[0].literal.name = "decision_accept_claim"
    else:
        knowledge = ExtractionOutput.model_construct(
            contract_version="2.0", knowledge_base=knowledge
        )
    extractor = UntrustedExtractor(knowledge)
    result = await analyze(case, catalog, extractor, settings(max_repair_attempts=0))
    assert result["knowledge_base"] is None and result["solver"] is None
    assert result["governance"]["requires_human"]
    assert result["attempts"][0]["status"] == "invalid_extraction"
    assert result["stage_trace"][-1]["error_code"] == code
    assert result["stage_trace"][-1]["output_ref"] is None
    assert extractor.extraction_calls == 1
    assert result["stage_trace"][1]["mode"] == "probabilistic"


@pytest.mark.asyncio
async def test_extractor_error_text_and_validation_payloads_are_not_echoed():
    case, catalog, _, knowledge = await bundle()
    extractor = UntrustedExtractor(knowledge, error=ExtractionError("SECRET-UPSTREAM-BODY"))
    result = await analyze(case, catalog, extractor, settings(max_repair_attempts=0))
    assert "SECRET-UPSTREAM-BODY" not in json.dumps(result)
    assert result["stage_trace"][-1]["error_code"] == "extraction_failed"


@pytest.mark.asyncio
@pytest.mark.parametrize("tamper", ["hash", "text", "version"])
async def test_retrieval_is_checked_against_catalog_outside_producer(tamper):
    case, catalog, retrieval, knowledge = await bundle()
    if tamper == "hash":
        retrieval.clauses[0].sha256 = "0" * 64
    elif tamper == "text":
        retrieval.clauses[0].text = "Invented clause."
        import hashlib

        retrieval.clauses[0].sha256 = hashlib.sha256(retrieval.clauses[0].text.encode()).hexdigest()
    else:
        retrieval.contract_version = "2.0"

    async def fabricated(*args):
        return retrieval

    catalog.retrieve = fabricated
    with pytest.raises(AnalysisFailure) as exc:
        await analyze(case, catalog, UntrustedExtractor(knowledge), settings())
    assert exc.value.result.stage_trace[0].status == "failed"
    assert exc.value.result.stage_trace[0].output_ref is None
    assert exc.value.result.governance.requires_human


@pytest.mark.asyncio
async def test_bounded_repair_records_every_attempt_and_no_extra_extractor_calls():
    class RecordingExtractor(DemoExtractor):
        def __init__(self):
            self.calls = 0

        async def extract(self, *args, **kwargs):
            self.calls += 1
            return await super().extract(*args, **kwargs)

    extractor = RecordingExtractor()
    result = await analyze(
        example("inconsistent.json"),
        PolicyCatalog(ROOT / "policies"),
        extractor,
        settings(max_repair_attempts=2),
    )
    assert extractor.calls == 3
    assert [attempt["decision"] for attempt in result["attempts"]] == ["repair", "repair", "return"]
    assert [
        step["attempt"] for step in result["stage_trace"] if step["component"] == "asp_reasoning"
    ] == [0, 1, 2]
    assert all(step["status"] == "succeeded" for step in result["stage_trace"])


@pytest.mark.asyncio
async def test_independent_verifier_scope_does_not_claim_semantic_entailment():
    case, _, retrieval, knowledge = await bundle()
    # A real quote/reference can be structurally valid while the interpreted rule
    # is semantically wrong. This ticket explicitly does not decide entailment.
    knowledge.rules[0].head.name = "decision_send_message"
    result = verify_knowledge(
        VerificationInput(case=case, retrieval=retrieval, knowledge_base=knowledge)
    )
    assert result.valid and not result.semantic_entailment_checked


@pytest.mark.asyncio
@pytest.mark.parametrize("failure", [False, True, "timeout"])
async def test_durable_stage_audit_reconstructs_success_failure_and_timeout(tmp_path, failure):
    database = Database(f"sqlite:///{tmp_path / 'trace.db'}")
    database.initialize()

    class FailingSelector(DemoExtractor):
        async def select_sections(self, *args):
            if failure == "timeout":
                await asyncio.sleep(2)
            raise RuntimeError("SECRET-UPSTREAM-BODY")

    configuration = settings()
    if failure == "timeout":
        # Shorten only this test's scheduling budget; production limits stay intact.
        configuration = configuration.model_copy(update={"analysis_timeout_seconds": 0.05})
    coordinator = Coordinator(
        configuration,
        database,
        extractor=FailingSelector() if failure else DemoExtractor(),
    )
    try:
        case = coordinator.create_case(example())
        queued = coordinator.enqueue(case["id"])
        assert await coordinator.process_one()
        with database.sessions() as session:
            run = session.get(RunRecord, queued["id"])
            stored = session.get(CaseRecord, case["id"])
            entries = audit_entries(session, case["id"])
            assert verify_chain(entries, stored.audit_hash, stored.audit_seq)
            reconstructed = [
                entry["data"]["step"] for entry in entries if entry["kind"] == "analysis_stage"
            ]
            assert reconstructed == run.result["stage_trace"]
            assert "SECRET-UPSTREAM-BODY" not in json.dumps(run.result)
            for stage in reconstructed:
                assert "input" not in stage and "output" not in stage
                if stage["status"] == "succeeded":
                    request, output = reconstruct_stage(
                        AnalysisStep.model_validate(stage),
                        AnalysisResult.model_validate(run.result),
                        CaseInput.model_validate(run.input_snapshot),
                        coordinator.catalog.get("demo_policy"),
                    )
                    assert stage["input_sha256"] == contract_hash(request)
                    assert stage["output_sha256"] == contract_hash(output)
            assert run.status == ("failed" if failure else "completed")
            if failure:
                assert reconstructed[-1]["status"] == "failed"
                assert reconstructed[-1]["error_code"] == (
                    "stage_timeout" if failure == "timeout" else "component_failed"
                )
    finally:
        await coordinator.close()
        database.close()


@pytest.mark.asyncio
@pytest.mark.parametrize("component", ["verification", "asp_reasoning", "governance"])
async def test_deterministic_producer_outputs_also_require_external_contract_validation(
    monkeypatch, component
):
    import disputeflow.service as service

    case, catalog, retrieval, knowledge = await bundle()
    if component == "verification":
        verified = verify_knowledge(
            VerificationInput(case=case, retrieval=retrieval, knowledge_base=knowledge)
        )
        monkeypatch.setattr(
            service,
            "verify_knowledge",
            lambda request: VerificationOutput.model_construct(
                contract_version="2.0", verification=verified
            ),
        )
        result = await analyze(case, catalog, DemoExtractor(), settings(max_repair_attempts=0))
    elif component == "asp_reasoning":
        result = solve(knowledge)
        monkeypatch.setattr(
            service,
            "solve",
            lambda *args, **kwargs: ReasoningOutput.model_construct(
                contract_version="2.0", solver=result
            ),
        )
        with pytest.raises(AnalysisFailure) as exc:
            await analyze(case, catalog, DemoExtractor(), settings())
        result = exc.value.result.model_dump(mode="json")
    else:
        result = await analyze(case, catalog, DemoExtractor(), settings())
        governance = AnalysisResult.model_validate(result).governance
        monkeypatch.setattr(
            service,
            "evaluate",
            lambda *args: GovernanceOutput.model_construct(
                contract_version="2.0", governance=governance
            ),
        )
        with pytest.raises(AnalysisFailure) as exc:
            await analyze(case, catalog, DemoExtractor(), settings())
        result = exc.value.result.model_dump(mode="json")
    assert result["stage_trace"][-1]["component"] == component
    assert result["stage_trace"][-1]["error_code"] == "invalid_contract"
    assert result["governance"]["requires_human"]
    typed = AnalysisResult.model_validate(result)
    for step in typed.stage_trace:
        if step.status == "succeeded":
            request, output = reconstruct_stage(step, typed, case, catalog.get(case.policy_id))
            assert step.input_sha256 == contract_hash(request)
            assert step.output_sha256 == contract_hash(output)


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("tamper", "error_code"), [("program", "program_input"), ("decisions", "model_decisions")]
)
async def test_reasoning_output_is_bound_to_input_program_and_positive_decision_literals(
    monkeypatch, tamper, error_code
):
    import disputeflow.service as service

    case, catalog, _, knowledge = await bundle()
    solver = solve(knowledge)
    if tamper == "program":
        solver.program = "% Fabricated unrelated program\n"
        solver.program_sha256 = hashlib.sha256(solver.program.encode()).hexdigest()
    else:
        solver.models[0].decisions = [Action.ACCEPT_CLAIM]
    monkeypatch.setattr(service, "solve", lambda *args, **kwargs: solver)
    with pytest.raises(AnalysisFailure) as exc:
        await analyze(case, catalog, DemoExtractor(), settings())
    failed = exc.value.result
    assert failed.stage_trace[-1].error_code == error_code
    assert failed.governance.requires_human and failed.knowledge_base is not None
    for step in failed.stage_trace[:-1]:
        request, output = reconstruct_stage(step, failed, case, catalog.get(case.policy_id))
        assert step.input_sha256 == contract_hash(request)
        assert step.output_sha256 == contract_hash(output)


@pytest.mark.asyncio
async def test_governance_mutation_isolated_and_unsafe_review_bypass_rejected(monkeypatch):
    import disputeflow.service as service

    original = service.evaluate
    case, catalog, _, _ = await bundle()
    configuration = settings()

    def mutating(case, knowledge, retrieval, solver, controls):
        result = original(case, knowledge, retrieval, solver, controls)
        case.summary = "Producer changed the case"
        retrieval.synthetic = False
        controls.auto_confidence_threshold = 0
        return result

    monkeypatch.setattr(service, "evaluate", mutating)
    result = AnalysisResult.model_validate(
        await analyze(case, catalog, DemoExtractor(), configuration)
    )
    assert result.retrieval.synthetic is True
    assert case.summary == example().summary
    assert configuration.auto_confidence_threshold == 0.95
    request, output = reconstruct_stage(
        result.stage_trace[-1], result, case, catalog.get(case.policy_id)
    )
    assert result.stage_trace[-1].input_sha256 == contract_hash(request)
    assert result.stage_trace[-1].output_sha256 == contract_hash(output)

    def bypass(*args):
        result = original(*args)
        result.requires_human = False
        result.reasons = []
        return result

    monkeypatch.setattr(service, "evaluate", bypass)
    with pytest.raises(AnalysisFailure) as exc:
        await analyze(case, catalog, DemoExtractor(), configuration)
    assert exc.value.result.stage_trace[-1].error_code == "governance_controls"
    assert exc.value.result.solver is not None
    for step in exc.value.result.stage_trace[:-1]:
        request, output = reconstruct_stage(
            step, exc.value.result, case, catalog.get(case.policy_id)
        )
        assert step.input_sha256 == contract_hash(request)
        assert step.output_sha256 == contract_hash(output)


@pytest.mark.asyncio
async def test_mid_analysis_timeout_retains_accepted_retrieval_for_reconstruction(tmp_path):
    class SlowExtractor(DemoExtractor):
        async def extract(self, *args, **kwargs):
            await asyncio.sleep(2)

    database = Database(f"sqlite:///{tmp_path / 'timeout.db'}")
    database.initialize()
    configuration = settings().model_copy(update={"analysis_timeout_seconds": 0.05})
    coordinator = Coordinator(configuration, database, extractor=SlowExtractor())
    try:
        case = coordinator.create_case(example())
        queued = coordinator.enqueue(case["id"])
        assert await coordinator.process_one()
        with database.sessions() as session:
            run = session.get(RunRecord, queued["id"])
            result = AnalysisResult.model_validate(run.result)
            assert run.status == "failed" and result.retrieval is not None
            assert result.stage_trace[-1].error_code == "stage_timeout"
            request, output = reconstruct_stage(
                result.stage_trace[0],
                result,
                CaseInput.model_validate(run.input_snapshot),
                coordinator.catalog.get("demo_policy"),
            )
            assert result.stage_trace[0].input_sha256 == contract_hash(request)
            assert result.stage_trace[0].output_sha256 == contract_hash(output)
    finally:
        await coordinator.close()
        database.close()


@pytest.mark.asyncio
async def test_cancellation_during_first_verifier_retains_extraction_for_replay(
    monkeypatch, tmp_path
):
    import disputeflow.service as service

    original_stage = service._stage

    async def slow_verifier(request, operation, *args, **kwargs):
        if request.component == "verification":

            async def delayed():
                await asyncio.sleep(2)
                return await operation()

            return await original_stage(request, delayed, *args, **kwargs)
        return await original_stage(request, operation, *args, **kwargs)

    monkeypatch.setattr(service, "_stage", slow_verifier)
    database = Database(f"sqlite:///{tmp_path / 'verifier-timeout.db'}")
    database.initialize()
    configuration = settings().model_copy(update={"analysis_timeout_seconds": 0.05})
    coordinator = Coordinator(configuration, database, extractor=DemoExtractor())
    try:
        case = coordinator.create_case(example())
        queued = coordinator.enqueue(case["id"])
        assert await coordinator.process_one()
        with database.sessions() as session:
            run = session.get(RunRecord, queued["id"])
            result = AnalysisResult.model_validate(run.result)
            assert run.status == "failed"
            assert result.knowledge_base is None and result.solver is None
            assert result.attempts[0].knowledge_base is not None
            assert result.attempts[0].status == "component_failed"
            assert result.stage_trace[-1].component == "verification"
            assert result.stage_trace[-1].error_code == "stage_timeout"
            for step in result.stage_trace[:-1]:
                request, output = reconstruct_stage(
                    step,
                    result,
                    CaseInput.model_validate(run.input_snapshot),
                    coordinator.catalog.get("demo_policy"),
                )
                assert step.input_sha256 == contract_hash(request)
                assert step.output_sha256 == contract_hash(output)
    finally:
        await coordinator.close()
        database.close()


def test_legacy_policy_reimport_is_idempotent_without_rewriting_original_hash(tmp_path):
    database = Database(f"sqlite:///{tmp_path / 'legacy.db'}")
    database.initialize()
    coordinator = Coordinator(settings(), database)
    policy = coordinator.catalog.get("demo_policy")
    policy.id = "legacy_imported_policy"
    original = policy.model_dump(mode="json")
    original.pop("authoritative_vocabulary")
    original_hash = digest(original)
    try:
        with database.sessions.begin() as session:
            session.add(PolicyRecord(id=policy.id, document=original, sha256=original_hash))
        assert coordinator.import_policy(policy).id == policy.id
        with database.sessions() as session:
            record = session.get(PolicyRecord, policy.id)
            assert record.document == original and record.sha256 == original_hash
    finally:
        database.close()


@pytest.mark.asyncio
async def test_paypal_refresh_updates_metadata_preserves_merchant_evidence_and_resets_changed_snapshot(
    tmp_path,
):
    import copy

    class SnapshotProvider:
        def __init__(self):
            self.snapshot = {
                "dispute_id": "PP-D-METADATA",
                "reason": "MERCHANDISE_OR_SERVICE_NOT_RECEIVED",
                "status": "WAITING_FOR_SELLER_RESPONSE",
                "dispute_life_cycle_stage": "INQUIRY",
                "seller_response_due_date": "2026-10-20T15:00:00Z",
                "dispute_amount": {"value": "49.90", "currency_code": "USD"},
                "links": [],
            }

        async def get_dispute(self, external_id):
            return copy.deepcopy(self.snapshot)

        async def close(self):
            pass

    database = Database(f"sqlite:///{tmp_path / 'metadata.db'}")
    database.initialize()
    provider = SnapshotProvider()
    coordinator = Coordinator(settings(), database, paypal=provider)
    try:
        case = await coordinator.import_paypal("PP-D-METADATA", "demo_policy")
        coordinator.update_evidence(
            case["id"],
            EvidenceUpdate(
                evidence=[
                    Evidence(
                        id="paypal_merchant_invoice",
                        content="Merchant-supplied invoice",
                        verified=True,
                    ),
                ]
            ),
        )
        coordinator.verify_evidence(
            case["id"],
            "paypal_snapshot",
            EvidenceVerificationInput(note="Snapshot reviewed against PayPal"),
        )
        unchanged = await coordinator.import_paypal("PP-D-METADATA", "demo_policy")
        unchanged_input = CaseInput.model_validate(unchanged["data"])
        assert next(
            item for item in unchanged_input.evidence if item.id == "paypal_snapshot"
        ).verified
        provider.snapshot.update(
            {
                "status": "UNDER_REVIEW",
                "dispute_life_cycle_stage": "CHARGEBACK",
                "seller_response_due_date": "2026-10-25T17:00:00Z",
            }
        )
        refreshed = await coordinator.import_paypal("PP-D-METADATA", "demo_policy")
        fresh_input = CaseInput.model_validate(refreshed["data"])
        assert fresh_input.paypal.status == "UNDER_REVIEW"
        assert fresh_input.paypal.dispute_life_cycle_stage == "CHARGEBACK"
        assert fresh_input.paypal.seller_response_due_date.day == 25
        assert refreshed["version"] == unchanged["version"] + 1
        assert any(
            item.id == "paypal_merchant_invoice" and item.verified for item in fresh_input.evidence
        )
        snapshot = next(item for item in fresh_input.evidence if item.id == "paypal_snapshot")
        assert snapshot.verified is False
        assert json.loads(snapshot.content) == provider.snapshot
        assert (
            CaseInput.model_validate(
                {key: value for key, value in refreshed["data"].items() if key != "paypal"}
            ).paypal
            is None
        )
    finally:
        await coordinator.close()
        database.close()
