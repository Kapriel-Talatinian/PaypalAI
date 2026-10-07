"""Exercise the authenticated HTTP workflow without contacting external services."""

from __future__ import annotations

import asyncio
import copy
import hashlib
import json
import shutil
from datetime import UTC, datetime, timedelta, timezone
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from pydantic import SecretStr

from disputeflow.api import create_app
from disputeflow.config import Settings
from disputeflow.db import CaseRecord, canonical, verify_chain
from disputeflow.domain import ClauseCitation, Fact, KnowledgeBase, Literal, PolicyDocument, Rule
from disputeflow.llm import DemoExtractor
from disputeflow.service import ServiceError, record_dict

ROOT = Path(__file__).resolve().parents[1]
SERVICE_HEADERS = {"X-API-Key": "test-service-key"}
REVIEWER_HEADERS = {"X-API-Key": "test-reviewer-key"}


class OfflinePayPal:
    def __init__(self):
        self.signature_valid = False
        self.webhook_checks = []

    async def close(self):
        pass

    async def verify_webhook(self, headers, event):
        self.webhook_checks.append(event)
        return self.signature_valid

    async def execute(self, *args, **kwargs):
        raise AssertionError("API tests must not perform a provider write")

    async def get_dispute(self, external_id):
        return _provider_snapshot(external_id)


def _provider_snapshot(external_id, *, resolved=False, update_time="2026-10-05T09:00:00Z"):
    return {
        "dispute_id": external_id,
        "reason": "MERCHANDISE_OR_SERVICE_NOT_RECEIVED",
        "status": "RESOLVED" if resolved else "WAITING_FOR_SELLER_RESPONSE",
        "update_time": update_time,
        "dispute_amount": {"value": "49.90", "currency_code": "USD"},
        "links": []
        if resolved
        else [
            {
                "rel": "accept-claim",
                "method": "POST",
                "href": f"https://api-m.sandbox.paypal.com/v1/customer/disputes/{external_id}/accept-claim",
            }
        ],
    }


@pytest.fixture
def api_client(tmp_path):
    policy_dir = tmp_path / "policies"
    policy_dir.mkdir()
    shutil.copy2(ROOT / "policies/demo-policy.json", policy_dir / "demo-policy.json")
    paypal = OfflinePayPal()
    settings = Settings(
        environment="test",
        database_url=f"sqlite:///{tmp_path / 'api.db'}",
        policy_dir=policy_dir,
        api_key=SecretStr(SERVICE_HEADERS["X-API-Key"]),
        reviewer_api_key=SecretStr(REVIEWER_HEADERS["X-API-Key"]),
        _env_file=None,
    )
    app = create_app(settings, extractor=DemoExtractor(), paypal=paypal)
    with TestClient(app) as client:
        yield client, paypal


def example():
    case = json.loads((ROOT / "examples/unique.json").read_text())
    case["allowed_actions"] = ["accept_claim", "provide_evidence"]
    return case


def create_and_analyze(client):
    response = client.post("/v1/disputes", json=example(), headers=SERVICE_HEADERS)
    assert response.status_code == 201
    case_id = response.json()["id"]
    queued = client.post(
        f"/v1/disputes/{case_id}/runs", json={"execute": False}, headers=SERVICE_HEADERS
    )
    assert queued.status_code == 202
    run_id = queued.json()["id"]
    assert client.get(f"/v1/runs/{run_id}/proof", headers=SERVICE_HEADERS).status_code == 409
    assert asyncio.run(client.app.state.coordinator.process_one())
    return case_id, run_id


@pytest.mark.parametrize(
    "timestamp",
    [
        datetime(2026, 10, 6, 8, 0),
        datetime(2026, 10, 6, 8, 0, tzinfo=UTC),
        datetime(2026, 10, 6, 10, 0, tzinfo=timezone(timedelta(hours=2))),
    ],
)
def test_record_serialization_keeps_timestamps_explicitly_utc(timestamp):
    case = CaseRecord(created_at=timestamp, updated_at=timestamp)
    serialized = record_dict(case)
    for field in ("created_at", "updated_at"):
        assert serialized[field] == datetime(2026, 10, 6, 8, 0, tzinfo=UTC)
        assert serialized[field].tzinfo is UTC


def test_api_authentication_health_and_readiness(api_client):
    client, _ = api_client
    health = client.get("/health")
    assert health.status_code == 200
    assert health.json()["status"] == "ok"
    assert health.headers["X-Request-ID"]
    assert client.get("/ready").status_code == 200
    assert client.get("/v1/disputes").status_code == 401
    assert client.get("/v1/metrics", headers={"X-API-Key": "wrong"}).status_code == 401
    assert client.get("/v1/disputes", headers=SERVICE_HEADERS).json()["total"] == 0
    assert client.get("/v1/disputes", headers=REVIEWER_HEADERS).status_code == 200


def test_http_workflow_preserves_program_proof_and_verified_audit(api_client):
    client, _ = api_client
    case_id, run_id = create_and_analyze(client)
    run = client.get(f"/v1/runs/{run_id}", headers=SERVICE_HEADERS).json()
    assert run["status"] == "completed"
    assert run["result"]["solver"]["status"] == "unique"
    assert run["result"]["governance"]["recommended_action"] == "provide_evidence"
    assert run["result"]["governance"]["requires_human"]
    assert "lease_owner" not in run
    assert (
        client.get(f"/v1/disputes/{case_id}", headers=SERVICE_HEADERS).json()["latest_run"]["id"]
        == run_id
    )
    proof = client.get(f"/v1/runs/{run_id}/proof", headers=SERVICE_HEADERS).json()
    assert proof == run["result"]["solver"]["proof"]
    assert any(node["kind"] == "citation" for node in proof["nodes"])
    program = client.get(f"/v1/runs/{run_id}/program", headers=SERVICE_HEADERS)
    assert program.status_code == 200
    assert program.headers["content-type"].startswith("text/plain")
    assert (
        hashlib.sha256(program.text.encode()).hexdigest()
        == run["result"]["solver"]["program_sha256"]
    )
    history = client.get(f"/v1/disputes/{case_id}/audit", headers=SERVICE_HEADERS).json()
    assert history["verified"]
    assert verify_chain(history["events"], history["head"], len(history["events"]))
    altered = copy.deepcopy(history["events"])
    altered[0]["data"]["version"] += 1
    assert not verify_chain(altered, history["head"], len(altered))
    reviews = client.get("/v1/reviews", headers=SERVICE_HEADERS).json()
    assert reviews["total"] == 1
    assert reviews["items"][0]["id"] == case_id
    metrics = client.get("/v1/metrics", headers=SERVICE_HEADERS).json()
    assert metrics["cases"] == {"review_required": 1}
    assert metrics["runs"] == {"completed": 1}


def test_reviewer_role_execution_idempotency_and_evidence_invalidate_authorization(api_client):
    client, _ = api_client
    case_id, run_id = create_and_analyze(client)
    review = {
        "action": "accept_claim",
        "note": "Reviewer explicitly approved acceptance for this demo.",
    }
    assert (
        client.post(f"/v1/runs/{run_id}/review", json=review, headers=SERVICE_HEADERS).status_code
        == 403
    )
    execution_headers = {**REVIEWER_HEADERS, "Idempotency-Key": "api-demo-response"}
    assert (
        client.post(f"/v1/runs/{run_id}/execute", json={}, headers=execution_headers).status_code
        == 409
    )
    assert (
        client.post(f"/v1/runs/{run_id}/review", json=review, headers=REVIEWER_HEADERS).status_code
        == 200
    )
    assert (
        client.post(f"/v1/runs/{run_id}/review", json=review, headers=REVIEWER_HEADERS).status_code
        == 409
    )
    blocked = client.post(
        f"/v1/runs/{run_id}/execute",
        json={},
        headers={**SERVICE_HEADERS, "Idempotency-Key": "unauthorized-execution"},
    )
    assert blocked.status_code == 403
    execution = client.post(f"/v1/runs/{run_id}/execute", json={}, headers=execution_headers)
    assert execution.status_code == 200
    journal = execution.json()
    assert journal["mode"] == "dry_run"
    assert journal["status"] == "succeeded"
    assert journal["response"]["dry_run"]
    replay = client.post(f"/v1/runs/{run_id}/execute", json={}, headers=execution_headers)
    assert replay.json()["id"] == journal["id"]
    assert (
        client.post(
            f"/v1/runs/{run_id}/execute",
            json={"payload": {"note": "Changed payload"}},
            headers=execution_headers,
        ).status_code
        == 409
    )
    assert client.get(f"/v1/executions/{journal['id']}", headers=SERVICE_HEADERS).status_code == 200
    update = json.loads((ROOT / "examples/nonmonotonic-evidence-update.json").read_text())
    changed = client.post(f"/v1/disputes/{case_id}/evidence", json=update, headers=SERVICE_HEADERS)
    assert changed.status_code == 200
    assert changed.json()["version"] == 2
    assert changed.json()["latest_run_id"] is None
    stale_review = client.post(f"/v1/runs/{run_id}/review", json=review, headers=REVIEWER_HEADERS)
    assert stale_review.status_code == 409
    assert "stale" in stale_review.json()["detail"]
    stale_execution = client.post(
        f"/v1/runs/{run_id}/execute",
        json={},
        headers={**REVIEWER_HEADERS, "Idempotency-Key": "stale-evidence-execution"},
    )
    assert stale_execution.status_code == 409
    assert "stale" in stale_execution.json()["detail"]
    assert client.get(f"/v1/runs/{run_id}/proof", headers=SERVICE_HEADERS).status_code == 200
    metrics = client.get("/v1/metrics", headers=SERVICE_HEADERS).json()
    assert metrics["executions"] == {"succeeded": 1}
    assert client.get(f"/v1/disputes/{case_id}/audit", headers=SERVICE_HEADERS).json()["verified"]


@pytest.mark.parametrize("suffix, empty_result", [("review", None), ("executions", [])])
def test_run_review_and_execution_reads_require_auth_and_distinguish_missing_runs(
    api_client, suffix, empty_result
):
    client, _ = api_client
    _, run_id = create_and_analyze(client)
    endpoint = f"/v1/runs/{run_id}/{suffix}"
    assert client.get(endpoint).status_code == 401
    assert client.get(endpoint, headers={"X-API-Key": "invalid"}).status_code == 401
    response = client.get(endpoint, headers=SERVICE_HEADERS)
    assert response.status_code == 200
    assert response.json() == empty_result
    assert client.get(endpoint, headers=REVIEWER_HEADERS).json() == empty_result
    assert (
        client.get(f"/v1/runs/absent/{suffix}", headers=SERVICE_HEADERS).status_code == 404
    )


def test_run_reads_restore_persisted_review_and_execution_without_cross_case_leaks(api_client):
    client, _ = api_client
    _, run_id = create_and_analyze(client)
    review = client.post(
        f"/v1/runs/{run_id}/review",
        json={"action": "accept_claim", "note": "Reviewed synthetic evidence before acceptance."},
        headers=REVIEWER_HEADERS,
    )
    assert review.status_code == 200
    execution = client.post(
        f"/v1/runs/{run_id}/execute",
        json={"payload": {"note": "Record the reviewed response in dry-run mode."}},
        headers={**REVIEWER_HEADERS, "Idempotency-Key": "restore-run-journal"},
    )
    assert execution.status_code == 200
    assert execution.json()["mode"] == "dry_run"
    assert execution.json()["status"] == "succeeded"

    # A new case/run remains empty even when another run has durable journal records.
    other_data = example()
    other_data["external_id"] = "DEMO-READ-OTHER-CASE"
    other_case = client.post("/v1/disputes", json=other_data, headers=SERVICE_HEADERS)
    assert other_case.status_code == 201
    other_run = client.post(
        f"/v1/disputes/{other_case.json()['id']}/runs", json={}, headers=SERVICE_HEADERS
    )
    assert other_run.status_code == 202
    other_run_id = other_run.json()["id"]
    assert client.get(f"/v1/runs/{other_run_id}/review", headers=SERVICE_HEADERS).json() is None
    assert client.get(f"/v1/runs/{other_run_id}/executions", headers=SERVICE_HEADERS).json() == []

    restored_review = client.get(f"/v1/runs/{run_id}/review", headers=SERVICE_HEADERS)
    restored_executions = client.get(f"/v1/runs/{run_id}/executions", headers=SERVICE_HEADERS)
    assert restored_review.status_code == 200
    assert restored_executions.status_code == 200
    assert restored_review.json() == review.json()
    assert restored_executions.json() == [execution.json()]
    assert restored_review.json()["run_id"] == run_id
    assert restored_executions.json()[0]["run_id"] == run_id


def test_policy_import_is_reviewer_only_and_immutable(api_client):
    client, _ = api_client
    policy = json.loads((ROOT / "policies/demo-policy.json").read_text())
    policy["id"] = "api_imported_policy"
    assert client.post("/v1/policies", json=policy).status_code == 401
    assert client.post("/v1/policies", json=policy, headers=SERVICE_HEADERS).status_code == 403
    imported = client.post("/v1/policies", json=policy, headers=REVIEWER_HEADERS)
    assert imported.status_code == 201
    assert imported.json()["id"] == "api_imported_policy"
    toc = client.get("/v1/policies/api_imported_policy/toc", headers=SERVICE_HEADERS)
    assert toc.status_code == 200
    assert toc.json()["sections"]
    changed = copy.deepcopy(policy)
    changed["sections"][0]["text"] = "Changed policy text after import."
    assert client.post("/v1/policies", json=changed, headers=REVIEWER_HEADERS).status_code == 422
    assert client.get("/v1/policies/absent/toc", headers=SERVICE_HEADERS).status_code == 404


def test_full_policy_read_requires_authentication_and_reports_missing_document(api_client):
    client, _ = api_client
    assert client.get("/v1/policies/demo_policy").status_code == 401
    assert (
        client.get("/v1/policies/demo_policy", headers={"X-API-Key": "invalid"}).status_code
        == 401
    )
    missing = client.get("/v1/policies/absent", headers=SERVICE_HEADERS)
    assert missing.status_code == 404
    assert missing.json()["detail"] == "Policy not found"


@pytest.mark.parametrize("imported", [False, True])
def test_full_policy_read_preserves_exact_nested_clause_text(api_client, imported):
    client, _ = api_client
    policy = json.loads((ROOT / "policies/demo-policy.json").read_text())
    if imported:
        policy["id"] = "full_text_imported_policy"
        policy["sections"][1]["children"][0]["text"] = (
            'Versioned source clause: "évidence vérifiée".\n'
            "Whitespace, accents, and exact quotation boundaries must survive retrieval."
        )
        response = client.post("/v1/policies", json=policy, headers=REVIEWER_HEADERS)
        assert response.status_code == 201
    expected = PolicyDocument.model_validate(policy).model_dump(mode="json")
    for headers in (SERVICE_HEADERS, REVIEWER_HEADERS):
        response = client.get(f"/v1/policies/{policy['id']}", headers=headers)
        assert response.status_code == 200
        assert response.json() == expected
        assert response.json()["sections"][1]["children"][0]["text"] == (
            policy["sections"][1]["children"][0]["text"]
        )


def test_invalid_webhook_signature_never_enqueues_and_valid_replay_deduplicates(api_client):
    client, paypal = api_client
    event = {
        "id": "event_test_1",
        "event_type": "CUSTOMER.DISPUTE.CREATED",
        "resource": {"dispute_id": "PP-D-WEBHOOK-TEST"},
    }
    rejected = client.post("/webhooks/paypal", json=event)
    assert rejected.status_code == 401
    assert paypal.webhook_checks == [event]
    assert client.get("/v1/metrics", headers=SERVICE_HEADERS).json()["webhooks"] == {}
    paypal.signature_valid = True
    accepted = client.post("/webhooks/paypal", json=event)
    assert accepted.status_code == 202
    assert accepted.json()["status"] == "queued"
    replay = client.post("/webhooks/paypal", json=event)
    assert replay.status_code == 202
    assert replay.json()["duplicate"]
    changed = {**event, "event_type": "CUSTOMER.DISPUTE.UPDATED"}
    assert client.post("/webhooks/paypal", json=changed).status_code == 409
    assert client.get("/v1/metrics", headers=SERVICE_HEADERS).json()["webhooks"] == {"queued": 1}
    assert client.post("/webhooks/paypal", content="not-json").status_code == 422


def test_http_validation_blocks_invalid_identifiers_and_unknown_policies(api_client):
    client, _ = api_client
    invalid = example()
    invalid["external_id"] = "../../invalid"
    assert client.post("/v1/disputes", json=invalid, headers=SERVICE_HEADERS).status_code == 422
    missing = example()
    missing["policy_id"] = "not_installed"
    assert client.post("/v1/disputes", json=missing, headers=SERVICE_HEADERS).status_code == 404
    assert client.get("/v1/disputes?limit=1000", headers=SERVICE_HEADERS).status_code == 422


class _FixtureExtractor:
    """Only for validating workflow boundaries with source-cited test rules."""

    provider = "isolated_test_fixture"

    async def select_sections(self, case, headings, path):
        return [heading["id"] for heading in headings]

    async def extract(self, case, retrieval, *, previous=None, diagnostics=None):
        clause = next(item for item in retrieval.clauses if item.id == "buyer_nonreceipt")
        return KnowledgeBase(
            facts=[
                Fact(
                    id="provider_claim",
                    literal=Literal(name="claim_nonreceipt"),
                    evidence_ids=["paypal_snapshot"],
                )
            ],
            rules=[
                Rule(
                    id="claim_response",
                    head=Literal(name="decision_accept_claim"),
                    body=[Literal(name="claim_nonreceipt")],
                    citations=[ClauseCitation(clause_id=clause.id, quote=clause.text)],
                )
            ],
        )


class _JournalPayPal(OfflinePayPal):
    """In-memory provider journal; execute never opens an HTTP connection."""

    def __init__(self):
        super().__init__()
        self.writes = []

    async def execute(
        self, external_id, action, payload, request_id, *, expected_snapshot_hash=None
    ):
        self.writes.append((external_id, action, payload, request_id, expected_snapshot_hash))
        return {"accepted": True}


def test_successful_external_execution_guard_survives_case_status_change(api_client):
    client, _ = api_client
    backend = client.app.state.coordinator
    backend.extractor = _FixtureExtractor()
    provider = _JournalPayPal()
    backend.paypal = provider
    backend.settings.execution_mode = "sandbox"
    # This finite policy is exclusively a test fixture, never actual PayPal terms.
    policy = json.loads((ROOT / "policies/demo-policy.json").read_text())
    policy.update(id="journal_test_fixture", synthetic=False, source_url="urn:test:journal-only")
    assert client.post("/v1/policies", json=policy, headers=REVIEWER_HEADERS).status_code == 201
    imported = client.post(
        "/v1/paypal/disputes/PP-D-JOURNAL/import",
        json={"policy_id": policy["id"]},
        headers=SERVICE_HEADERS,
    )
    assert imported.status_code == 200
    case_id = imported.json()["id"]
    queued = client.post(f"/v1/disputes/{case_id}/runs", json={}, headers=SERVICE_HEADERS)
    assert queued.status_code == 202
    run_id = queued.json()["id"]
    assert asyncio.run(backend.process_one())
    review = {"action": "accept_claim", "note": "Approved finite workflow test response."}
    assert (
        client.post(f"/v1/runs/{run_id}/review", json=review, headers=REVIEWER_HEADERS).status_code
        == 200
    )
    executed = client.post(
        f"/v1/runs/{run_id}/execute",
        json={},
        headers={**REVIEWER_HEADERS, "Idempotency-Key": "durable-first-write"},
    )
    assert executed.status_code == 200
    assert executed.json()["status"] == "succeeded"
    assert len(provider.writes) == 1
    assert (
        client.post(f"/v1/disputes/{case_id}/runs", json={}, headers=SERVICE_HEADERS).status_code
        == 409
    )
    # Simulate an independent status regression; the durable journal must still
    # prevent another external write for this unchanged evidence version.
    with backend.db.sessions.begin() as session:
        case = session.get(CaseRecord, case_id)
        case.status = "open"
    next_run = client.post(f"/v1/disputes/{case_id}/runs", json={}, headers=SERVICE_HEADERS)
    assert next_run.status_code == 202
    next_run_id = next_run.json()["id"]
    assert asyncio.run(backend.process_one())
    assert (
        client.post(
            f"/v1/runs/{next_run_id}/review", json=review, headers=REVIEWER_HEADERS
        ).status_code
        == 200
    )
    rejected = client.post(
        f"/v1/runs/{next_run_id}/execute",
        json={},
        headers={**REVIEWER_HEADERS, "Idempotency-Key": "durable-second-write"},
    )
    assert rejected.status_code == 409
    assert "successful external execution" in rejected.json()["detail"]
    assert len(provider.writes) == 1
    assert client.get("/v1/metrics", headers=SERVICE_HEADERS).json()["executions"] == {
        "succeeded": 1
    }


class _ConcurrentSnapshots(OfflinePayPal):
    def __init__(self):
        super().__init__()
        self.started = asyncio.Event()
        self.release = asyncio.Event()
        self.read_count = 0

    async def get_dispute(self, external_id):
        self.read_count += 1
        if self.read_count == 1:
            self.started.set()
            await self.release.wait()
            return _provider_snapshot(external_id, update_time="2026-10-05T10:00:00Z")
        return _provider_snapshot(external_id, resolved=True, update_time="2026-10-05T11:00:00Z")


@pytest.mark.parametrize("existing", [False, True])
def test_concurrent_import_rejects_slow_old_snapshot_and_keeps_latest(api_client, existing):
    client, _ = api_client
    backend = client.app.state.coordinator
    external_id = "PP-D-IMPORT-RACE"
    if existing:
        assert (
            client.post(
                f"/v1/paypal/disputes/{external_id}/import", json={}, headers=SERVICE_HEADERS
            ).status_code
            == 200
        )

    async def import_race():
        provider = _ConcurrentSnapshots()
        backend.paypal = provider
        slow = asyncio.create_task(backend.import_paypal(external_id, "demo_policy"))
        await asyncio.wait_for(provider.started.wait(), timeout=2)
        latest = await backend.import_paypal(external_id, "demo_policy")
        provider.release.set()
        with pytest.raises(ServiceError, match="changed during import") as exc:
            await slow
        assert exc.value.status == 409
        return latest

    newest = asyncio.run(import_race())
    stored = client.get(f"/v1/disputes/{newest['id']}", headers=SERVICE_HEADERS).json()
    assert stored["status"] == "resolved"
    assert stored["version"] == (2 if existing else 1)
    snapshot = next(item for item in stored["data"]["evidence"] if item["id"] == "paypal_snapshot")
    assert json.loads(snapshot["content"])["update_time"] == "2026-10-05T11:00:00Z"
    assert stored["data"]["allowed_actions"] == []
    assert client.get(f"/v1/disputes/{newest['id']}/audit", headers=SERVICE_HEADERS).json()[
        "verified"
    ]


def test_registered_policy_survives_new_coordinator_with_empty_filesystem_catalog(
    api_client, tmp_path
):
    client, _ = api_client
    policy = json.loads((ROOT / "policies/demo-policy.json").read_text())
    # Preserve the finite demo policy's identity so its demo extractor is valid;
    # registering it persists the bundled document in the shared database.
    assert client.post("/v1/policies", json=policy, headers=REVIEWER_HEADERS).status_code == 201
    empty = tmp_path / "other_worker_policies"
    empty.mkdir()
    settings = client.app.state.coordinator.settings.model_copy(update={"policy_dir": empty})
    app = create_app(settings, extractor=DemoExtractor(), paypal=OfflinePayPal())
    with TestClient(app) as restarted:
        assert restarted.get("/ready").status_code == 200
        policies = restarted.get("/v1/policies", headers=SERVICE_HEADERS).json()["items"]
        assert {item["id"] for item in policies} == {policy["id"]}
        fixture = example()
        fixture["policy_id"] = policy["id"]
        created = restarted.post("/v1/disputes", json=fixture, headers=SERVICE_HEADERS)
        assert created.status_code == 201
        case_id = created.json()["id"]
        queued = restarted.post(f"/v1/disputes/{case_id}/runs", json={}, headers=SERVICE_HEADERS)
        assert queued.status_code == 202
        assert asyncio.run(app.state.coordinator.process_one())
        result = restarted.get(f"/v1/runs/{queued.json()['id']}", headers=SERVICE_HEADERS).json()
        assert result["status"] == "completed"
        assert result["result"]["retrieval"]["policy_id"] == policy["id"]
        assert result["result"]["solver"]["status"] == "unique"
    assert list(empty.iterdir()) == []


def test_reviewer_verifies_imported_evidence_and_binds_new_version_in_audit(
    api_client, monkeypatch
):
    client, paypal = api_client
    imported = client.post(
        "/v1/paypal/disputes/PP-D-VERIFY/import", json={}, headers=SERVICE_HEADERS
    )
    assert imported.status_code == 200
    original = imported.json()
    case_id = original["id"]
    url = f"/v1/disputes/{case_id}/evidence/paypal_snapshot/verify"
    verification = {"verified": True, "note": "Reviewer checked the imported provider snapshot."}
    assert client.post(url, json=verification, headers=SERVICE_HEADERS).status_code == 403
    queued = client.post(f"/v1/disputes/{case_id}/runs", json={}, headers=SERVICE_HEADERS)
    assert queued.status_code == 202
    checked = client.post(url, json=verification, headers=REVIEWER_HEADERS)
    assert checked.status_code == 200
    updated = checked.json()
    assert updated["version"] == original["version"] + 1
    assert updated["latest_run_id"] is None
    source = original["data"]["evidence"][0]
    reviewed = updated["data"]["evidence"][0]
    assert reviewed["verified"] is True
    assert reviewed["content"] == source["content"]
    assert reviewed["source"] == source["source"]
    history = client.get(f"/v1/disputes/{case_id}/audit", headers=SERVICE_HEADERS).json()
    assert history["verified"]
    event = history["events"][-1]
    assert event["kind"] == "evidence_verification"
    assert event["actor"] == "reviewer"
    assert event["data"]["version"] == updated["version"]
    assert event["data"]["note"] == verification["note"]
    assert (
        event["data"]["data_sha256"]
        == hashlib.sha256(canonical(updated["data"]).encode()).hexdigest()
    )
    assert asyncio.run(client.app.state.coordinator.process_one())
    old = client.get(f"/v1/runs/{queued.json()['id']}", headers=SERVICE_HEADERS).json()
    assert old["status"] == "stale"
    assert (
        client.post(
            f"/v1/disputes/{case_id}/evidence/missing/verify",
            json=verification,
            headers=REVIEWER_HEADERS,
        ).status_code
        == 404
    )
    identical = client.post(
        "/v1/paypal/disputes/PP-D-VERIFY/import", json={}, headers=SERVICE_HEADERS
    )
    assert identical.status_code == 200
    assert identical.json()["version"] == updated["version"]
    assert identical.json()["data"]["evidence"][0]["verified"] is True
    assert identical.json()["data"]["evidence"][0]["content"] == source["content"]

    async def changed_snapshot(external_id):
        return _provider_snapshot(external_id, update_time="2026-10-05T12:00:00Z")

    monkeypatch.setattr(paypal, "get_dispute", changed_snapshot)
    refreshed = client.post(
        "/v1/paypal/disputes/PP-D-VERIFY/import", json={}, headers=SERVICE_HEADERS
    )
    assert refreshed.status_code == 200
    assert refreshed.json()["version"] == updated["version"] + 1
    assert refreshed.json()["data"]["evidence"][0]["verified"] is False
    assert refreshed.json()["data"]["evidence"][0]["content"] != source["content"]
    assert client.get(f"/v1/disputes/{case_id}/audit", headers=SERVICE_HEADERS).json()["verified"]


def test_merged_evidence_limit_returns_validation_error_and_preserves_case(api_client):
    client, _ = api_client
    body = example()
    body["evidence"] = [
        {"id": f"evidence_{index}", "content": f"Reviewed observation {index}."}
        for index in range(100)
    ]
    created = client.post("/v1/disputes", json=body, headers=SERVICE_HEADERS)
    assert created.status_code == 201
    case_id = created.json()["id"]
    overflow = client.post(
        f"/v1/disputes/{case_id}/evidence",
        json={
            "evidence": [{"id": "additional_evidence", "content": "One additional observation."}]
        },
        headers=SERVICE_HEADERS,
    )
    assert overflow.status_code == 422
    stored = client.get(f"/v1/disputes/{case_id}", headers=SERVICE_HEADERS).json()
    assert stored["version"] == created.json()["version"]
    assert len(stored["data"]["evidence"]) == 100
    assert all(item["id"] != "additional_evidence" for item in stored["data"]["evidence"])
    assert client.get(f"/v1/disputes/{case_id}/audit", headers=SERVICE_HEADERS).json()["verified"]


@pytest.mark.parametrize("key", ["invalid-clé".encode(), b"\xff\xfe"])
def test_non_ascii_auth_header_returns_unauthorized_without_server_error(api_client, key):
    client, _ = api_client
    response = client.get("/v1/metrics", headers=[(b"X-API-Key", key)])
    assert response.status_code == 401
