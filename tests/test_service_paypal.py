"""Financial execution journal tests: all provider calls are in-memory fakes."""

import copy
from pathlib import Path

import pytest
from pydantic import SecretStr
from sqlalchemy import select

from disputeflow.config import Settings
from disputeflow.db import CaseRecord, Database, ExecutionRecord, RunRecord, WebhookRecord
from disputeflow.domain import Action, CaseInput, Evidence, EvidenceUpdate, ReviewInput
from disputeflow.paypal import PayPalError
from disputeflow.service import Coordinator, ServiceError

ROOT = Path(__file__).resolve().parents[1]
DISPUTE_ID = "PP-D-27803"


class FakePayPal:
    def __init__(self):
        self.reads = []
        self.writes = []
        self.error = None
        self.snapshot = {
            "dispute_id": DISPUTE_ID,
            "reason": "MERCHANDISE_OR_SERVICE_NOT_RECEIVED",
            "status": "WAITING_FOR_SELLER_RESPONSE",
            "dispute_life_cycle_stage": "INQUIRY",
            "dispute_amount": {"currency_code": "USD", "value": "30.00"},
            "update_time": "2026-10-05T12:00:00Z",
            "links": [
                {
                    "rel": "accept_claim",
                    "method": "POST",
                    "href": f"https://api-m.sandbox.paypal.com/v1/customer/disputes/{DISPUTE_ID}/accept-claim",
                }
            ],
        }

    async def get_dispute(self, external_id):
        self.reads.append(external_id)
        return copy.deepcopy(self.snapshot)

    async def execute(self, external_id, action, payload, request_id, **kwargs):
        self.writes.append(
            {
                "external_id": external_id,
                "action": action,
                "payload": payload,
                "request_id": request_id,
            }
        )
        if self.error:
            raise self.error
        return {"links": []}

    async def close(self):
        pass


@pytest.fixture
def coordinator(tmp_path):
    config = Settings(
        _env_file=None,
        database_url=f"sqlite:///{tmp_path / 'test.db'}",
        policy_dir=ROOT / "policies",
        execution_mode="sandbox",
        paypal_client_id="test-client",
        paypal_client_secret=SecretStr("test-secret"),
    )
    database = Database(config.database_url)
    database.initialize()
    instance = Coordinator(config, database, paypal=FakePayPal())
    yield instance
    database.close()


def completed_run(coordinator, case, *, synthetic=False):
    # Seed an already completed analysis to isolate transaction/execution gates.
    queued = coordinator.enqueue(case["id"])
    with coordinator.db.sessions.begin() as session:
        run = session.get(RunRecord, queued["id"])
        run.status = "completed"
        run.result = {
            "governance": {
                "requires_human": True,
                "recommended_action": Action.ACCEPT_CLAIM.value,
                "confidence": 1,
            },
            "retrieval": {"synthetic": synthetic},
            "solver": {"status": "unique"},
        }
        session.get(CaseRecord, case["id"]).status = "review_required"
    return queued["id"]


def approve(coordinator, run_id):
    return coordinator.review(
        run_id,
        ReviewInput(
            action=Action.ACCEPT_CLAIM,
            note="Operator approved the refund after checking the evidence.",
        ),
    )


async def test_unchanged_provider_import_preserves_version_and_operator_evidence(coordinator):
    first = await coordinator.import_paypal(DISPUTE_ID, "demo_policy")
    assert first["origin"] == "paypal"
    assert first["data"]["evidence"][0]["id"] == "paypal_snapshot"
    assert not first["data"]["evidence"][0]["verified"]
    change = EvidenceUpdate(
        evidence=[
            Evidence(
                id="operator_delivery", content="Carrier lookup confirmed delivery", verified=True
            )
        ]
    )
    changed = coordinator.update_evidence(first["id"], change)
    assert changed["version"] == first["version"] + 1
    refreshed = await coordinator.import_paypal(DISPUTE_ID, "demo_policy")
    assert refreshed["version"] == changed["version"]
    assert {item["id"] for item in refreshed["data"]["evidence"]} == {
        "paypal_snapshot",
        "operator_delivery",
    }


async def test_provider_refresh_invalidates_completed_review(coordinator):
    first = await coordinator.import_paypal(DISPUTE_ID, "demo_policy")
    run_id = completed_run(coordinator, first)
    approve(coordinator, run_id)
    coordinator.paypal.snapshot["update_time"] = "2026-10-05T12:01:00Z"
    refreshed = await coordinator.import_paypal(DISPUTE_ID, "demo_policy")
    assert refreshed["version"] == first["version"] + 1
    assert refreshed["latest_run_id"] is None
    with pytest.raises(ServiceError, match="stale"):
        await coordinator.execute(run_id, {"note": "Refund"}, "stale-request")
    assert coordinator.paypal.writes == []


async def test_operator_cannot_replace_reserved_provider_snapshot(coordinator):
    imported = await coordinator.import_paypal(DISPUTE_ID, "demo_policy")
    with pytest.raises(ServiceError, match="only be refreshed"):
        coordinator.update_evidence(
            imported["id"],
            EvidenceUpdate(
                evidence=[Evidence(id="paypal_snapshot", content="Spoofed data", verified=True)]
            ),
        )


async def test_same_key_replays_journal_and_different_key_cannot_repeat_run(coordinator):
    imported = await coordinator.import_paypal(DISPUTE_ID, "demo_policy")
    run_id = completed_run(coordinator, imported)
    approve(coordinator, run_id)
    first = await coordinator.execute(run_id, {"note": "Full refund"}, "request-1")
    replay = await coordinator.execute(run_id, {"note": "Full refund"}, "request-1")
    assert first["id"] == replay["id"]
    assert first["status"] == "succeeded"
    assert len(coordinator.paypal.writes) == 1
    with pytest.raises(ServiceError):
        await coordinator.execute(run_id, {"note": "Full refund"}, "request-2")
    with pytest.raises(ServiceError, match="different request"):
        await coordinator.execute(run_id, {"note": "Changed refund request"}, "request-1")
    assert len(coordinator.paypal.writes) == 1


async def test_uncertain_write_blocks_mutation_reanalysis_refresh_and_retry(coordinator):
    imported = await coordinator.import_paypal(DISPUTE_ID, "demo_policy")
    run_id = completed_run(coordinator, imported)
    approve(coordinator, run_id)
    coordinator.paypal.error = PayPalError(
        0, "PAYPAL_TRANSPORT_ERROR", "Provider request interrupted", uncertain=True
    )
    attempt = await coordinator.execute(run_id, {"note": "Full refund"}, "request-1")
    assert attempt["status"] == "uncertain"
    with coordinator.db.sessions() as session:
        assert session.get(CaseRecord, imported["id"]).status == "execution_uncertain"
    with pytest.raises(ServiceError, match="Reconcile"):
        coordinator.enqueue(imported["id"])
    with pytest.raises(ServiceError, match="Reconcile"):
        coordinator.update_evidence(
            imported["id"],
            EvidenceUpdate(evidence=[Evidence(id="new_statement", content="Additional evidence")]),
        )
    with pytest.raises(ServiceError, match="Reconcile"):
        await coordinator.import_paypal(DISPUTE_ID, "demo_policy")
    with pytest.raises(ServiceError, match="Reconcile"):
        await coordinator.execute(run_id, {"note": "Full refund"}, "request-2")
    replay = await coordinator.execute(run_id, {"note": "Full refund"}, "request-1")
    assert replay["status"] == "uncertain"
    assert len(coordinator.paypal.writes) == 1


async def test_real_execution_rejects_synthetic_policy(coordinator):
    imported = await coordinator.import_paypal(DISPUTE_ID, "demo_policy")
    run_id = completed_run(coordinator, imported, synthetic=True)
    approve(coordinator, run_id)
    with pytest.raises(ServiceError, match="Synthetic policy"):
        await coordinator.execute(run_id, {"note": "Full refund"}, "request-1")
    assert coordinator.paypal.writes == []
    with coordinator.db.sessions() as session:
        assert session.scalar(select(ExecutionRecord)) is None


async def test_real_execution_rejects_manual_origin_even_with_external_id(coordinator):
    local = coordinator.create_case(
        CaseInput(
            external_id=DISPUTE_ID,
            reason="Nonreceipt",
            amount="30",
            summary="Locally created record",
            allowed_actions=[Action.ACCEPT_CLAIM],
        )
    )
    run_id = completed_run(coordinator, local)
    approve(coordinator, run_id)
    with pytest.raises(ServiceError, match="PayPal-imported"):
        await coordinator.execute(run_id, {"note": "Full refund"}, "request-1")
    assert coordinator.paypal.writes == []


async def test_webhook_is_deduplicated_and_imports_current_provider_data(coordinator):
    event = {
        "id": "WH-EVENT-1",
        "event_type": "CUSTOMER.DISPUTE.CREATED",
        "resource": {"dispute_id": DISPUTE_ID, "status": "forged-status-is-not-imported"},
    }
    assert not coordinator.store_webhook(event)["duplicate"]
    assert coordinator.store_webhook(event)["duplicate"]
    modified = copy.deepcopy(event)
    modified["resource"]["status"] = "changed"
    with pytest.raises(ServiceError, match="different content"):
        coordinator.store_webhook(modified)
    assert await coordinator.process_one()
    assert coordinator.paypal.reads == [DISPUTE_ID]
    assert coordinator.paypal.writes == []
    with coordinator.db.sessions() as session:
        webhook = session.get(WebhookRecord, event["id"])
        assert webhook.status == "done"
        case = session.scalar(select(CaseRecord).where(CaseRecord.external_id == DISPUTE_ID))
        assert case.origin == "paypal"
        assert case.data["evidence"][0]["verified"] is False
        assert "forged-status-is-not-imported" not in case.data["evidence"][0]["content"]
        run = session.get(RunRecord, case.latest_run_id)
        assert run.status == "queued"
        assert not run.execute_requested


def test_unrelated_webhook_is_ignored(coordinator):
    stored = coordinator.store_webhook(
        {"id": "WH-PAYMENT-1", "event_type": "PAYMENT.CAPTURE.COMPLETED"}
    )
    assert stored["status"] == "ignored"


async def test_resolved_provider_snapshot_is_not_enqueued(coordinator):
    coordinator.paypal.snapshot["status"] = "RESOLVED"
    coordinator.paypal.snapshot["links"] = []
    coordinator.store_webhook(
        {
            "id": "WH-RESOLVED-1",
            "event_type": "CUSTOMER.DISPUTE.RESOLVED",
            "resource": {"dispute_id": DISPUTE_ID},
        }
    )
    assert await coordinator.process_one()
    with coordinator.db.sessions() as session:
        case = session.scalar(select(CaseRecord).where(CaseRecord.external_id == DISPUTE_ID))
        assert case.status == "resolved"
        assert case.latest_run_id is None
        assert session.scalar(select(RunRecord)) is None
