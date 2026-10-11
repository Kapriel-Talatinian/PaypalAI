"""Integration checks for persisted coordination and irreversible-write boundaries."""

from __future__ import annotations

import asyncio
import copy
from datetime import timedelta
from pathlib import Path
from types import SimpleNamespace

import pytest
from pydantic import SecretStr
from sqlalchemy import select

from disputeflow.config import Settings
from disputeflow.db import (
    CaseRecord,
    Database,
    ExecutionRecord,
    RunRecord,
    audit_entries,
    now,
    verify_chain,
)
from disputeflow.domain import (
    Action,
    CaseInput,
    ClauseCitation,
    Evidence,
    EvidenceUpdate,
    Fact,
    KnowledgeBase,
    Literal,
    ReviewInput,
    Rule,
)
from disputeflow.llm import DemoExtractor
from disputeflow.paypal import PayPalError
from disputeflow.policy import PolicyCatalog
from disputeflow.service import Coordinator, ServiceError, analyze

ROOT = Path(__file__).resolve().parents[1]
_ACTIONS = [Action.ACCEPT_CLAIM, Action.PROVIDE_EVIDENCE]


def example(name="unique.json"):
    case = CaseInput.model_validate_json((ROOT / "examples" / name).read_text())
    case.allowed_actions = list(_ACTIONS)
    return case


class FakePayPal:
    """A test-only provider; tests never make an external HTTP request."""

    def __init__(self):
        self.calls = []
        self.reads = []
        self.error = None
        self.snapshot_status = "WAITING_FOR_SELLER_RESPONSE"

    async def close(self):
        pass

    async def get_dispute(self, external_id):
        self.reads.append(external_id)
        return {
            "dispute_id": external_id,
            "reason": "MERCHANDISE_OR_SERVICE_NOT_RECEIVED",
            "status": self.snapshot_status,
            "dispute_amount": {"value": "49.90", "currency_code": "USD"},
            "links": [
                {
                    "rel": action.value.replace("_", "-"),
                    "method": "POST",
                    "href": f"https://api-m.sandbox.paypal.com/v1/customer/disputes/{external_id}/{action.value.replace('_', '-')}",
                }
                for action in _ACTIONS
            ],
        }

    async def execute(self, external_id, action, payload, request_id, **kwargs):
        self.calls.append((external_id, action, copy.deepcopy(payload), request_id))
        if self.error:
            raise self.error
        return {"accepted": True, "dispute_id": external_id}


class ImportedCaseExtractor:
    """Exercise live workflow boundaries with a finite source-cited test rule."""

    provider = "test_fixture"

    async def select_sections(self, case, headings, path):
        return [heading["id"] for heading in headings]

    async def extract(self, case, retrieval, *, previous=None, diagnostics=None):
        reference = next(
            (item.id for item in case.evidence if item.id == "operator_review"), "paypal_snapshot"
        )
        clause = next(item for item in retrieval.clauses if item.id == "buyer_nonreceipt")
        return KnowledgeBase(
            facts=[
                Fact(
                    id="verified_claim",
                    literal=Literal(name="claim_nonreceipt"),
                    evidence_ids=[reference],
                )
            ],
            rules=[
                Rule(
                    id="accept_nonreceipt",
                    head=Literal(name="decision_accept_claim"),
                    body=[Literal(name="claim_nonreceipt")],
                    citations=[ClauseCitation(clause_id=clause.id, quote=clause.text)],
                )
            ],
            confidence=1,
        )


@pytest.fixture
def make_coordinator(tmp_path):
    databases = []

    def make(*, live=False, extractor=None):
        directory = tmp_path / f"instance_{len(databases)}"
        directory.mkdir()
        policy_dir = directory / "policies"
        catalog = PolicyCatalog(policy_dir)
        policy = PolicyCatalog(ROOT / "policies").get("demo_policy")
        if live:
            # This copied policy is exclusively a workflow TEST fixture. No test
            # represents its semantics as actual PayPal terms or invokes PayPal.
            policy.id = "workflow_test_policy"
            policy.synthetic = False
            policy.source_url = "urn:disputeflow:test-fixture-only"
        catalog.import_document(policy)
        database = Database(f"sqlite:///{directory / 'test.db'}")
        database.initialize()
        databases.append(database)
        settings = Settings(
            environment="test",
            database_url=f"sqlite:///{directory / 'test.db'}",
            policy_dir=policy_dir,
            execution_mode="sandbox" if live else "dry_run",
            paypal_environment="sandbox",
            paypal_client_id="fake-client" if live else "",
            paypal_client_secret=SecretStr("fake-secret") if live else None,
            _env_file=None,
        )
        paypal = FakePayPal()
        coordinator = Coordinator(
            settings,
            database,
            extractor=extractor or (ImportedCaseExtractor() if live else DemoExtractor()),
            paypal=paypal,
        )
        return SimpleNamespace(
            coordinator=coordinator,
            db=database,
            paypal=paypal,
            settings=settings,
            policy_id=policy.id,
        )

    yield make
    for database in databases:
        database.close()


def stored_case(env, case_id):
    with env.db.sessions() as session:
        return session.get(CaseRecord, case_id)


def stored_run(env, run_id):
    with env.db.sessions() as session:
        return session.get(RunRecord, run_id)


async def run_case(env, fixture="unique.json"):
    case = env.coordinator.create_case(example(fixture))
    run = env.coordinator.enqueue(case["id"])
    assert await env.coordinator.process_one()
    return case, stored_run(env, run["id"])


async def import_and_analyze(env, *, verified=True):
    case = await env.coordinator.import_paypal("PP-D-WORKFLOW-TEST", env.policy_id)
    if verified:
        env.coordinator.update_evidence(
            case["id"],
            EvidenceUpdate(
                evidence=[
                    Evidence(
                        id="operator_review",
                        content="Operator verified the buyer's nonreceipt evidence.",
                        verified=True,
                        source="test_operator",
                    )
                ]
            ),
        )
    run = env.coordinator.enqueue(case["id"])
    assert await env.coordinator.process_one()
    return case, stored_run(env, run["id"])


def assert_error(error, status, text):
    assert error.value.status == status
    assert text in error.value.detail


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("fixture", "solver_status", "attempt_count", "recommendation"),
    [
        ("unique.json", "unique", 1, "provide_evidence"),
        ("ambiguous.json", "multiple", 1, None),
        ("inconsistent.json", "inconsistent", 3, None),
    ],
)
async def test_complete_analysis_persists_solver_governance_and_audit(
    make_coordinator, fixture, solver_status, attempt_count, recommendation
):
    env = make_coordinator()
    case, run = await run_case(env, fixture)
    assert run.status == "completed"
    assert run.result["solver"]["status"] == solver_status
    assert len(run.result["attempts"]) == attempt_count
    assert run.result["governance"]["recommended_action"] == recommendation
    assert run.result["governance"]["requires_human"]
    assert stored_case(env, case["id"]).status == "review_required"
    assert not await env.coordinator.process_one()
    with env.db.sessions() as session:
        record = session.get(CaseRecord, case["id"])
        entries = audit_entries(session, case["id"])
        assert verify_chain(entries, record.audit_hash, record.audit_seq)
        assert [entry["kind"] for entry in entries] == [
            "case_created",
            "analysis_queued",
            "analysis_started",
            "analysis_completed",
        ]


@pytest.mark.asyncio
async def test_inconsistency_retries_have_diagnostics_and_keep_verified_facts(make_coordinator):
    class RecordingExtractor(DemoExtractor):
        def __init__(self):
            self.repairs = []

        async def extract(self, case, retrieval, *, previous=None, diagnostics=None):
            self.repairs.append((previous, diagnostics))
            return await super().extract(
                case, retrieval, previous=previous, diagnostics=diagnostics
            )

    extractor = RecordingExtractor()
    env = make_coordinator(extractor=extractor)
    _, run = await run_case(env, "inconsistent.json")
    assert len(extractor.repairs) == 3
    assert extractor.repairs[0] == (None, None)
    for previous, diagnostics in extractor.repairs[1:]:
        assert {fact.literal.key() for fact in previous.facts} >= {
            "delivery_verified",
            "-delivery_verified",
        }
        assert diagnostics and "no consistent stable model" in diagnostics[0]
    assert all(attempt["status"] == "inconsistent" for attempt in run.result["attempts"])


@pytest.mark.asyncio
async def test_correction_cannot_drop_verified_fact_to_manufacture_consistency(make_coordinator):
    class DroppingExtractor(DemoExtractor):
        async def extract(self, case, retrieval, *, previous=None, diagnostics=None):
            knowledge = await super().extract(
                case, retrieval, previous=previous, diagnostics=diagnostics
            )
            if previous is not None:
                knowledge.facts = [fact for fact in knowledge.facts if not fact.literal.negated]
            return knowledge

    env = make_coordinator(extractor=DroppingExtractor())
    result = await analyze(
        example("inconsistent.json"),
        env.coordinator.catalog,
        env.coordinator.extractor,
        env.settings,
    )
    assert [attempt["status"] for attempt in result["attempts"]] == [
        "inconsistent",
        "invalid_extraction",
        "invalid_extraction",
    ]
    assert result["knowledge_base"] is None
    assert result["solver"] is None
    assert result["governance"]["requires_human"]
    assert "removed a fact backed by verified evidence" in result["attempts"][-1]["diagnostics"][0]


@pytest.mark.asyncio
async def test_queue_deduplicates_and_stale_input_is_never_analyzed(make_coordinator):
    env = make_coordinator()
    case = env.coordinator.create_case(example())
    first = env.coordinator.enqueue(case["id"])
    assert env.coordinator.enqueue(case["id"])["id"] == first["id"]
    with pytest.raises(ServiceError) as exc:
        env.coordinator.enqueue(case["id"], execute=True)
    assert_error(exc, 409, "different execution request")
    env.coordinator.update_evidence(
        case["id"],
        EvidenceUpdate(
            evidence=[Evidence(id="new_tracking", content="FACT:tracking_invalid", verified=True)]
        ),
    )
    assert await env.coordinator.process_one()
    old_run = stored_run(env, first["id"])
    assert old_run.status == "stale"
    assert old_run.result is None
    assert stored_case(env, case["id"]).version == 2


@pytest.mark.asyncio
async def test_queued_analysis_survives_coordinator_restart(make_coordinator):
    env = make_coordinator()
    case = env.coordinator.create_case(example())
    queued = env.coordinator.enqueue(case["id"])
    restarted = Coordinator(env.settings, env.db, extractor=DemoExtractor(), paypal=env.paypal)
    assert await restarted.process_one()
    run = stored_run(env, queued["id"])
    assert run.status == "completed"
    assert run.result["solver"]["status"] == "unique"
    assert not await restarted.process_one()


@pytest.mark.asyncio
async def test_reclaimed_lease_prevents_old_worker_from_publishing_its_result(make_coordinator):
    class DelayedFirstExtractor(DemoExtractor):
        def __init__(self):
            self.first_started = asyncio.Event()
            self.release_first = asyncio.Event()
            self.calls = 0

        async def extract(self, case, retrieval, *, previous=None, diagnostics=None):
            self.calls += 1
            current = self.calls
            if current == 1:
                self.first_started.set()
                await self.release_first.wait()
            knowledge = await super().extract(
                case, retrieval, previous=previous, diagnostics=diagnostics
            )
            knowledge.warnings.append(
                "obsolete worker result" if current == 1 else "reclaimed worker result"
            )
            return knowledge

    extractor = DelayedFirstExtractor()
    env = make_coordinator(extractor=extractor)
    case = env.coordinator.create_case(example())
    run = env.coordinator.enqueue(case["id"])
    original_worker = asyncio.create_task(env.coordinator.process_one())
    try:
        await asyncio.wait_for(extractor.first_started.wait(), timeout=5)
        with env.db.sessions.begin() as session:
            record = session.get(RunRecord, run["id"])
            original_owner = record.lease_owner
            record.lease_until = now() - timedelta(seconds=1)
        assert await env.coordinator.process_one()
        reclaimed = stored_run(env, run["id"])
        assert reclaimed.status == "completed"
        assert reclaimed.lease_owner != original_owner
        assert "reclaimed worker result" in reclaimed.result["knowledge_base"]["warnings"]
    finally:
        extractor.release_first.set()
        await asyncio.wait_for(original_worker, timeout=10)
    completed = stored_run(env, run["id"])
    assert "obsolete worker result" not in completed.result["knowledge_base"]["warnings"]
    with env.db.sessions() as session:
        entries = audit_entries(session, case["id"])
        assert sum(entry["kind"] == "analysis_completed" for entry in entries) == 1


@pytest.mark.asyncio
async def test_evidence_update_invalidates_review_and_recomputes_nonmonotonic_decision(
    make_coordinator,
):
    env = make_coordinator()
    case, old_run = await run_case(env, "nonmonotonic-before.json")
    env.coordinator.review(
        old_run.id,
        ReviewInput(action=Action.PROVIDE_EVIDENCE, note="Reviewed original delivery evidence."),
    )
    updated = env.coordinator.update_evidence(
        case["id"],
        EvidenceUpdate.model_validate_json(
            (ROOT / "examples/nonmonotonic-evidence-update.json").read_text()
        ),
    )
    assert updated["version"] == 2
    assert updated["latest_run_id"] is None
    with pytest.raises(ServiceError) as exc:
        env.coordinator.review(
            old_run.id,
            ReviewInput(action=Action.ACCEPT_CLAIM, note="Old run cannot authorize new evidence."),
        )
    assert_error(exc, 409, "Run is stale")
    with pytest.raises(ServiceError) as exc:
        await env.coordinator.execute(old_run.id, {}, "stale-run-attempt")
    assert_error(exc, 409, "Run is stale")
    new = env.coordinator.enqueue(case["id"])
    assert await env.coordinator.process_one()
    new_run = stored_run(env, new["id"])
    assert new_run.result["governance"]["recommended_action"] == "accept_claim"
    assert old_run.result["governance"]["recommended_action"] == "provide_evidence"
    assert new_run.result["solver"]["program_sha256"] != old_run.result["solver"]["program_sha256"]


@pytest.mark.asyncio
async def test_human_review_is_required_binds_action_and_cannot_be_replaced(make_coordinator):
    env = make_coordinator()
    _, run = await run_case(env)
    with pytest.raises(ServiceError) as exc:
        await env.coordinator.execute(run.id, {}, "before-review")
    assert_error(exc, 409, "reviewer must approve")
    review = env.coordinator.review(
        run.id,
        ReviewInput(
            action=Action.ACCEPT_CLAIM,
            note="Operator chose acceptance after reviewing the supporting evidence.",
        ),
    )
    assert review["action"] == "accept_claim"
    with pytest.raises(ServiceError) as exc:
        env.coordinator.review(
            run.id,
            ReviewInput(action=Action.PROVIDE_EVIDENCE, note="Cannot overwrite signed-off review."),
        )
    assert_error(exc, 409, "already reviewed")
    execution = await env.coordinator.execute(run.id, {}, "reviewed-accept")
    assert execution["action"] == "accept_claim"
    assert execution["mode"] == "dry_run"
    assert execution["response"]["dry_run"]
    assert not env.paypal.calls


@pytest.mark.asyncio
async def test_unverified_imported_facts_force_governance_review(make_coordinator):
    env = make_coordinator(live=True)
    _, run = await import_and_analyze(env, verified=False)
    assert run.result["solver"]["status"] == "unique"
    governance = run.result["governance"]
    assert governance["confidence"] == 0
    assert governance["components"]["verified_provenance"] == 0
    assert governance["requires_human"]
    assert "Some facts lack verified evidence provenance" in governance["reasons"]
    with pytest.raises(ServiceError) as exc:
        await env.coordinator.execute(run.id, {}, "unverified-blocked")
    assert_error(exc, 409, "reviewer must approve")
    assert not env.paypal.calls


@pytest.mark.asyncio
async def test_imported_execution_is_locally_idempotent_and_conflicting_replays_fail(
    make_coordinator,
):
    env = make_coordinator(live=True)
    case, run = await import_and_analyze(env)
    assert run.result["governance"]["requires_human"] is False
    payload = {"note": "Reviewed test fixture claim acceptance."}
    first = await env.coordinator.execute(run.id, payload, "single-provider-write")
    second = await env.coordinator.execute(run.id, payload, "single-provider-write")
    assert first["id"] == second["id"]
    assert first["status"] == "succeeded"
    assert len(env.paypal.calls) == 1
    assert env.paypal.calls[0][0] == "PP-D-WORKFLOW-TEST"
    assert stored_case(env, case["id"]).status == "executed"
    with pytest.raises(ServiceError) as exc:
        await env.coordinator.execute(
            run.id, {"note": "Different request body."}, "single-provider-write"
        )
    assert_error(exc, 409, "different request")
    with pytest.raises(ServiceError) as exc:
        await env.coordinator.execute(run.id, payload, "new-key-same-version")
    assert_error(exc, 409, "already has an external response")
    assert len(env.paypal.calls) == 1
    with env.db.sessions() as session:
        assert len(list(session.scalars(select(ExecutionRecord)))) == 1


@pytest.mark.asyncio
async def test_uncertain_write_blocks_mutations_and_reconciliation_restores_workflow(
    make_coordinator,
):
    env = make_coordinator(live=True)
    case, run = await import_and_analyze(env)
    env.paypal.error = PayPalError(
        0, "PAYPAL_TRANSPORT_ERROR", "Simulated lost response", uncertain=True
    )
    execution = await env.coordinator.execute(run.id, {}, "uncertain-operation")
    assert execution["status"] == "uncertain"
    assert stored_case(env, case["id"]).status == "execution_uncertain"
    repeat = await env.coordinator.execute(run.id, {}, "uncertain-operation")
    assert repeat["id"] == execution["id"]
    assert len(env.paypal.calls) == 1
    changes = EvidenceUpdate(
        evidence=[
            Evidence(
                id="operator_followup", content="New evidence after reconciliation.", verified=True
            )
        ]
    )
    for operation in [
        lambda: env.coordinator.update_evidence(case["id"], changes),
        lambda: env.coordinator.enqueue(case["id"]),
    ]:
        with pytest.raises(ServiceError) as exc:
            operation()
        assert_error(exc, 409, "Reconcile")
    with pytest.raises(ServiceError) as exc:
        await env.coordinator.execute(run.id, {}, "uncertain-new-key")
    assert_error(exc, 409, "Reconcile")
    reconciled = env.coordinator.reconcile(
        execution["id"], "failed", "Operator checked provider and confirmed no write was accepted."
    )
    assert reconciled["status"] == "failed"
    assert stored_case(env, case["id"]).status == "review_required"
    changed = env.coordinator.update_evidence(case["id"], changes)
    assert changed["version"] == 3
    env.paypal.error = None
    next_run = env.coordinator.enqueue(case["id"])
    assert await env.coordinator.process_one()
    completed = stored_run(env, next_run["id"])
    next_execution = await env.coordinator.execute(completed.id, {}, "reconciled-new-version")
    assert next_execution["status"] == "succeeded"
    assert len(env.paypal.calls) == 2


@pytest.mark.asyncio
async def test_interrupted_write_keeps_durable_intent_and_requires_delayed_reconciliation(
    make_coordinator,
):
    env = make_coordinator(live=True)
    case, run = await import_and_analyze(env)
    env.paypal.error = asyncio.CancelledError()
    with pytest.raises(asyncio.CancelledError):
        await env.coordinator.execute(run.id, {}, "interrupted-write")
    with env.db.sessions() as session:
        intent = session.scalar(select(ExecutionRecord).where(ExecutionRecord.run_id == run.id))
        assert intent.status == "in_flight"
        execution_id = intent.id
    assert stored_case(env, case["id"]).status == "executing"
    duplicate = await env.coordinator.execute(run.id, {}, "interrupted-write")
    assert duplicate["id"] == execution_id
    assert duplicate["status"] == "in_flight"
    assert len(env.paypal.calls) == 1
    with pytest.raises(ServiceError) as exc:
        env.coordinator.reconcile(
            execution_id, "succeeded", "Operator verified the provider state."
        )
    assert_error(exc, 409, "may still be running")
    # Simulate observing the journal after the recovery safety window.
    with env.db.sessions.begin() as session:
        session.get(ExecutionRecord, execution_id).created_at = now() - timedelta(minutes=5)
    reconciled = env.coordinator.reconcile(
        execution_id,
        "succeeded",
        "Operator confirmed this interrupted request was accepted by the provider.",
    )
    assert reconciled["status"] == "succeeded"
    assert stored_case(env, case["id"]).status == "executed"
    assert len(env.paypal.calls) == 1


@pytest.mark.asyncio
async def test_real_execution_rejects_manual_origin_and_synthetic_policy(make_coordinator):
    env = make_coordinator(live=True)
    local = example("nonmonotonic-after.json")
    local.policy_id = env.policy_id
    local.evidence.append(
        Evidence(id="operator_review", content="Reviewed local fixture evidence.", verified=True)
    )
    local_case = env.coordinator.create_case(local)
    local_run = env.coordinator.enqueue(local_case["id"])
    assert await env.coordinator.process_one()
    with pytest.raises(ServiceError) as exc:
        await env.coordinator.execute(local_run["id"], {}, "manual-real-blocked")
    assert_error(exc, 409, "PayPal-imported")
    assert not env.paypal.calls

    synthetic = make_coordinator()
    synthetic.settings.execution_mode = "sandbox"
    case = await synthetic.coordinator.import_paypal("PP-D-SYNTHETIC-TEST", "demo_policy")
    synthetic.coordinator.update_evidence(
        case["id"],
        EvidenceUpdate(
            evidence=[Evidence(id="verified_buyer", content="FACT:claim_nonreceipt", verified=True)]
        ),
    )
    run = synthetic.coordinator.enqueue(case["id"])
    assert await synthetic.coordinator.process_one()
    synthetic.coordinator.review(
        run["id"],
        ReviewInput(
            action=Action.ACCEPT_CLAIM, note="Review cannot make synthetic policy contractual."
        ),
    )
    with pytest.raises(ServiceError) as exc:
        await synthetic.coordinator.execute(run["id"], {}, "synthetic-real-blocked")
    assert_error(exc, 409, "Synthetic policy")
    assert not synthetic.paypal.calls


@pytest.mark.asyncio
async def test_import_refresh_preserves_operator_evidence_and_same_snapshot_is_idempotent(
    make_coordinator,
):
    env = make_coordinator(live=True)
    case, _ = await import_and_analyze(env)
    before = stored_case(env, case["id"])
    refreshed = await env.coordinator.import_paypal("PP-D-WORKFLOW-TEST", env.policy_id)
    assert refreshed["id"] == case["id"]
    assert refreshed["version"] == before.version
    assert {item["id"] for item in refreshed["data"]["evidence"]} == {
        "paypal_snapshot",
        "operator_review",
    }
    with pytest.raises(ServiceError) as exc:
        env.coordinator.update_evidence(
            case["id"],
            EvidenceUpdate(
                evidence=[
                    Evidence(
                        id="paypal_snapshot", content="Forged provider evidence", verified=True
                    )
                ]
            ),
        )
    assert_error(exc, 422, "only be refreshed from PayPal")


@pytest.mark.asyncio
@pytest.mark.parametrize("unsupported", [False, True])
async def test_strict_chain_ambiguity_and_formalization_errors_never_trigger_repair(
    make_coordinator, unsupported
):
    class RecordingExtractor(DemoExtractor):
        def __init__(self):
            self.calls = []

        async def extract(self, case, retrieval, *, previous=None, diagnostics=None):
            self.calls.append((previous, diagnostics))
            clause = retrieval.clauses[0]
            citation = ClauseCitation(clause_id=clause.id, quote=clause.text)
            rules = [
                Rule(id="seller", head=Literal(name="delivery"), citations=[citation]),
                Rule(id="buyer", head=Literal(name="nonreceipt"), citations=[citation]),
                Rule(
                    id="delivered",
                    kind="strict",
                    head=Literal(name="received"),
                    body=[Literal(name="delivery")],
                    citations=[citation],
                ),
                Rule(
                    id="missing",
                    kind="strict",
                    head=Literal(name="received", negated=True),
                    body=[Literal(name="nonreceipt")],
                    citations=[citation],
                ),
            ]
            if unsupported:
                rules[2].unless = [Literal(name="received")]
            return KnowledgeBase(rules=rules)

    extractor = RecordingExtractor()
    env = make_coordinator(extractor=extractor)
    case, run = await run_case(env)
    assert run.status == "completed"
    assert extractor.calls == [(None, None)]
    assert len(run.result["attempts"]) == 1
    assert run.result["knowledge_base"]["rules"]
    assert run.result["governance"]["requires_human"]
    assert run.result["governance"]["recommended_action"] is None
    assert stored_case(env, case["id"]).status == "review_required"
    assert env.paypal.calls == []
    if unsupported:
        assert run.result["solver"] is None
        assert run.result["attempts"][0]["status"] == "unsupported_formalization"
        assert "delivered" in run.result["attempts"][0]["diagnostics"][0]
    else:
        assert run.result["solver"]["status"] == "multiple"
        assert len(run.result["solver"]["models"]) == 2
