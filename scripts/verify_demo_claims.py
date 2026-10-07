#!/usr/bin/env python3
"""Verify synthetic dispute claims through the real API, worker, and clingo.

Run with: .venv/bin/python scripts/verify_demo_claims.py
The database and authentication keys are ephemeral. HTTP network transports are
blocked, environment configuration is ignored, and no external provider is used.
"""

from __future__ import annotations

import argparse
import asyncio
import copy
import hashlib
import json
import os
import secrets
import tempfile
from contextlib import ExitStack, contextmanager
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from unittest.mock import patch

import clingo
import httpx
from fastapi.testclient import TestClient
from pydantic import SecretStr

from disputeflow.api import create_app
from disputeflow.config import Settings
from disputeflow.db import verify_chain
from disputeflow.domain import CaseInput, KnowledgeBase, RetrievalResult
from disputeflow.llm import DemoExtractor, validate_grounding

ROOT = Path(__file__).resolve().parents[1]


def require(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)


@contextmanager
def isolated_configuration():
    """Prevent inherited DISPUTEFLOW_* values and .env files from influencing QA."""
    with patch.dict(os.environ):
        for key in list(os.environ):
            if key.startswith("DISPUTEFLOW_"):
                del os.environ[key]
        yield


class NetworkGuard:
    """Deny real HTTP transports, while leaving FastAPI's in-process ASGI transport intact."""

    def __init__(self) -> None:
        self.attempts = 0

    def sync_request(self, *_args: Any, **_kwargs: Any) -> None:
        self.attempts += 1
        raise AssertionError("Outbound HTTP is prohibited during demo verification")

    async def async_request(self, *_args: Any, **_kwargs: Any) -> None:
        self.attempts += 1
        raise AssertionError("Outbound HTTP is prohibited during demo verification")


class Harness:
    def __init__(self, client: TestClient) -> None:
        self.client = client
        settings = client.app.state.coordinator.settings
        self.service = {"X-API-Key": settings.api_key.get_secret_value()}
        self.reviewer = {"X-API-Key": settings.reviewer_api_key.get_secret_value()}
        self.runs: list[dict[str, Any]] = []

    def request(
        self,
        method: str,
        path: str,
        *,
        status: int = 200,
        reviewer: bool = False,
        body: dict[str, Any] | None = None,
        idempotency_key: str | None = None,
    ) -> httpx.Response:
        headers = dict(self.reviewer if reviewer else self.service)
        if idempotency_key:
            headers["Idempotency-Key"] = idempotency_key
        response = self.client.request(method, path, headers=headers, json=body)
        require(
            response.status_code == status,
            f"{method} {path}: expected HTTP {status}, received {response.status_code}",
        )
        return response

    def fixture(self, filename: str, external_id: str) -> dict[str, Any]:
        data = json.loads((ROOT / "examples" / filename).read_text())
        data.update(external_id=external_id, auto_execute=False)
        return data

    def create(self, data: dict[str, Any]) -> dict[str, Any]:
        return self.request("POST", "/v1/disputes", status=201, body=data).json()

    def analyze(self, case_id: str) -> dict[str, Any]:
        queued = self.request(
            "POST", f"/v1/disputes/{case_id}/runs", status=202, body={"execute": False}
        ).json()
        require(queued["status"] == "queued", "Run must first persist in the durable queue")
        self.request("GET", f"/v1/runs/{queued['id']}/proof", status=409)
        require(
            asyncio.run(self.client.app.state.coordinator.process_one()),
            "The actual durable worker did not claim the queued run",
        )
        run = self.request("GET", f"/v1/runs/{queued['id']}").json()
        require(run["status"] == "completed", "The real analysis did not complete")
        require(run["result"] is not None, "The real analysis returned no result")
        result = run["result"]
        require(result["solver"] is not None, "clingo did not return a solver result")
        require(result["solver"]["enumeration_complete"], "Model enumeration was incomplete")
        validate_grounding(
            KnowledgeBase.model_validate(result["knowledge_base"]),
            CaseInput.model_validate(run["input_snapshot"]),
            RetrievalResult.model_validate(result["retrieval"]),
        )
        program = self.request("GET", f"/v1/runs/{run['id']}/program").text
        require(
            hashlib.sha256(program.encode()).hexdigest() == result["solver"]["program_sha256"],
            "Persisted ASP program does not match its SHA-256",
        )
        proof = self.request("GET", f"/v1/runs/{run['id']}/proof").json()
        require(
            proof == result["solver"]["proof"], "Proof endpoint differs from persisted analysis"
        )
        require(
            any(node["kind"] == "citation" for node in proof["nodes"]),
            "Policy citations are missing",
        )
        self.runs.append(run)
        return run

    def audit(self, case_id: str) -> dict[str, Any]:
        trail = self.request("GET", f"/v1/disputes/{case_id}/audit").json()
        require(trail["verified"], "The API rejected the persisted audit chain")
        require(
            verify_chain(trail["events"], trail["head"], len(trail["events"])),
            "Independent audit verification failed",
        )
        altered = copy.deepcopy(trail["events"])
        altered[0]["data"]["version"] = -1
        require(
            not verify_chain(altered, trail["head"], len(altered)),
            "Tampering was not detected by independent audit verification",
        )
        return {
            "verified": True,
            "independently_verified": True,
            "tampering_detected": True,
            "event_count": len(trail["events"]),
            "event_kinds": [event["kind"] for event in trail["events"]],
            "chain_head": trail["head"],
        }

    def summary(self, run: dict[str, Any]) -> dict[str, Any]:
        result = run["result"]
        solver = result["solver"]
        return {
            "run_id": run["id"],
            "case_id": run["case_id"],
            "case_version": run["case_version"],
            "status": run["status"],
            "solver_status": solver["status"],
            "stable_model_count": len(solver["models"]),
            "model_actions": [model["decisions"] for model in solver["models"]],
            "recommended_action": result["governance"]["recommended_action"],
            "requires_human": result["governance"]["requires_human"],
            "governance_reasons": result["governance"]["reasons"],
            "fact_literals": [
                ("-" if fact["literal"]["negated"] else "") + fact["literal"]["name"]
                for fact in result["knowledge_base"]["facts"]
            ],
            "analysis_attempts": len(result["attempts"]),
            "program_sha256": solver["program_sha256"],
            "program_hash_verified": True,
            "grounding_verified": True,
            "proof_nodes": len(solver["proof"]["nodes"]),
            "proof_edges": len(solver["proof"]["edges"]),
        }

    def expect(self, run: dict[str, Any], solver: str, action: str | None) -> None:
        result = run["result"]
        require(result["solver"]["status"] == solver, f"Expected solver outcome {solver}")
        require(result["governance"]["recommended_action"] == action, f"Expected action {action}")
        require(
            result["governance"]["requires_human"], "Synthetic policy must require human review"
        )

    def execute_gate(self, run: dict[str, Any], key: str) -> dict[str, Any]:
        response = self.request(
            "POST",
            f"/v1/runs/{run['id']}/execute",
            status=409,
            reviewer=True,
            body={"payload": {"note": "Synthetic verification only."}},
            idempotency_key=key,
        )
        return {"http_status": response.status_code, "detail": response.json()["detail"]}


def verify(harness: Harness) -> dict[str, Any]:
    delivery = harness.create(harness.fixture("unique.json", "VERIFY-DELIVERY"))
    first = harness.analyze(delivery["id"])
    harness.expect(first, "unique", "provide_evidence")
    before_approval = harness.execute_gate(first, "verify-before-review")
    review_body = {
        "action": "provide_evidence",
        "note": "Verified the synthetic carrier record and exact demonstration policy citations.",
    }
    unauthorized = harness.request(
        "POST", f"/v1/runs/{first['id']}/review", status=403, body=review_body
    )
    approved = harness.request(
        "POST", f"/v1/runs/{first['id']}/review", reviewer=True, body=review_body
    ).json()
    payload = {
        "evidences": [
            {
                "evidence_type": "OTHER",
                "notes": "Synthetic reviewed carrier delivery record; demonstration response only.",
            }
        ]
    }
    executed = harness.request(
        "POST",
        f"/v1/runs/{first['id']}/execute",
        reviewer=True,
        body={"payload": payload},
        idempotency_key="verify-delivery-response",
    ).json()
    require(executed["status"] == "succeeded", "Reviewed dry run did not succeed")
    require(
        executed["mode"] == "dry_run" and executed["response"]["dry_run"],
        "Execution was not a dry run",
    )
    require(executed["action"] == "provide_evidence", "Execution lost the reviewed merchant action")
    require(executed["payload"] == payload, "Explicit reviewed payload changed")
    audit_before_replay = harness.audit(delivery["id"])
    replay = harness.request(
        "POST",
        f"/v1/runs/{first['id']}/execute",
        reviewer=True,
        body={"payload": payload},
        idempotency_key="verify-delivery-response",
    ).json()
    require(replay["id"] == executed["id"], "Idempotent retry created another execution")
    journal = harness.request("GET", f"/v1/runs/{first['id']}/executions").json()
    require(len(journal) == 1, "Idempotent retry duplicated the execution journal")
    require(
        harness.audit(delivery["id"])["chain_head"] == audit_before_replay["chain_head"],
        "Idempotent retry appended another execution audit",
    )
    changed_payload = harness.request(
        "POST",
        f"/v1/runs/{first['id']}/execute",
        status=409,
        reviewer=True,
        body={
            "payload": {
                "evidences": [{"evidence_type": "OTHER", "notes": "Different synthetic response."}]
            }
        },
        idempotency_key="verify-delivery-response",
    )
    state_after_dry_run = harness.request("GET", f"/v1/disputes/{delivery['id']}").json()
    require(
        state_after_dry_run["status"] == "reviewed",
        "Dry run must not resolve or externally submit the dispute",
    )

    correction = json.loads((ROOT / "examples/nonmonotonic-evidence-update.json").read_text())
    updated = harness.request(
        "POST", f"/v1/disputes/{delivery['id']}/evidence", body=correction
    ).json()
    require(
        updated["version"] == 2 and updated["latest_run_id"] is None,
        "Evidence did not invalidate the prior authorization",
    )
    stale_review = harness.request(
        "POST", f"/v1/runs/{first['id']}/review", status=409, reviewer=True, body=review_body
    )
    require(
        "stale" in stale_review.json()["detail"].lower(), "Old review was not rejected as stale"
    )
    stale_execution = harness.execute_gate(first, "verify-stale-response")
    revised = harness.analyze(delivery["id"])
    harness.expect(revised, "unique", "accept_claim")
    require(
        revised["case_version"] == 2, "The revised analysis did not use the new evidence version"
    )
    require(
        first["result"]["solver"]["program_sha256"]
        != revised["result"]["solver"]["program_sha256"],
        "New tracking evidence did not change the compiled program",
    )

    mismatch_input = harness.fixture("ambiguous.json", "VERIFY-LEGITIMATE-MISMATCH")
    mismatch_input["evidence"] = [
        item for item in mismatch_input["evidence"] if item["id"] == "buyer_quality_report"
    ]
    mismatch_input["summary"] = (
        "Synthetic verified item mismatch: buyer quality report, without a contrary seller inspection."
    )
    mismatch = harness.create(mismatch_input)
    mismatch_run = harness.analyze(mismatch["id"])
    harness.expect(mismatch_run, "unique", "accept_claim")

    competing = harness.create(harness.fixture("ambiguous.json", "VERIFY-COMPETING-RULES"))
    competing_run = harness.analyze(competing["id"])
    harness.expect(competing_run, "multiple", None)
    require(
        len(competing_run["result"]["solver"]["models"]) == 2,
        "Competing rules did not preserve both extensions",
    )
    competing_gate = harness.execute_gate(competing_run, "verify-competing-gate")

    inconsistent = harness.create(
        harness.fixture("inconsistent.json", "VERIFY-CONTRADICTORY-FACTS")
    )
    inconsistent_run = harness.analyze(inconsistent["id"])
    harness.expect(inconsistent_run, "inconsistent", None)
    require(
        not inconsistent_run["result"]["solver"]["models"],
        "Contradictory facts unexpectedly produced a stable model",
    )
    for attempt in inconsistent_run["result"]["attempts"]:
        literals = {
            ("-" if fact["literal"]["negated"] else "") + fact["literal"]["name"]
            for fact in attempt["knowledge_base"]["facts"]
        }
        require(
            {"delivery_verified", "-delivery_verified"} <= literals,
            "Self-correction discarded verified contradictory facts",
        )
    inconsistent_gate = harness.execute_gate(inconsistent_run, "verify-inconsistent-gate")

    unverified_input = harness.fixture("unique.json", "VERIFY-UNVERIFIED-TRACKING")
    for item in unverified_input["evidence"]:
        if item["id"] == "carrier_record":
            item["verified"] = False
    unverified = harness.create(unverified_input)
    unverified_run = harness.analyze(unverified["id"])
    harness.expect(unverified_run, "unique", "accept_claim")
    require(
        not any(
            fact["literal"]["name"] == "delivery_verified"
            for fact in unverified_run["result"]["knowledge_base"]["facts"]
        ),
        "Unverified tracking was promoted into a fact",
    )

    scenarios = {
        "verified_delivery": {**harness.summary(first), "audit": audit_before_replay},
        "nonmonotonic_tracking_correction": {
            **harness.summary(revised),
            "previous_action": first["result"]["governance"]["recommended_action"],
            "stale_review": {
                "http_status": stale_review.status_code,
                "detail": stale_review.json()["detail"],
            },
            "stale_execution": stale_execution,
            "previous_authorization_invalidated": updated["latest_run_id"] is None,
            "audit": harness.audit(delivery["id"]),
        },
        "legitimate_item_mismatch": {
            **harness.summary(mismatch_run),
            "audit": harness.audit(mismatch["id"]),
        },
        "competing_rules": {
            **harness.summary(competing_run),
            "execution_gate": competing_gate,
            "audit": harness.audit(competing["id"]),
        },
        "contradictory_verified_facts": {
            **harness.summary(inconsistent_run),
            "verified_facts_retained_in_all_attempts": True,
            "execution_gate": inconsistent_gate,
            "audit": harness.audit(inconsistent["id"]),
        },
        "unverified_tracking": {
            **harness.summary(unverified_run),
            "unverified_tracking_promoted": False,
            "audit": harness.audit(unverified["id"]),
        },
    }
    require(
        not asyncio.run(harness.client.app.state.coordinator.process_one()),
        "An unexpected job remained in the isolated worker queue",
    )
    return {
        "scenarios": scenarios,
        "review_and_execution": {
            "execution_without_review": before_approval,
            "service_key_cannot_review": unauthorized.status_code,
            "reviewed_action": approved["action"],
            "execution_id": executed["id"],
            "execution_mode": executed["mode"],
            "execution_status": executed["status"],
            "explicit_payload_preserved": True,
            "idempotent_retry_execution_id": replay["id"],
            "journal_count_after_retry": len(journal),
            "changed_payload_same_key_http_status": changed_payload.status_code,
            "case_status_after_dry_run": state_after_dry_run["status"],
            "external_payment_or_message_sent": False,
        },
        "actual_analysis_runs": len(harness.runs),
        "actual_clingo_solver_attempts": sum(
            len(run["result"]["attempts"]) for run in harness.runs
        ),
        "isolated_database_metrics": harness.request("GET", "/v1/metrics").json(),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--output", type=Path, default=ROOT / "artifacts/demo-claims-verification.json"
    )
    args = parser.parse_args()
    guard = NetworkGuard()
    with ExitStack() as stack:
        stack.enter_context(isolated_configuration())
        temporary = Path(
            stack.enter_context(tempfile.TemporaryDirectory(prefix="disputeflow-claim-qa-"))
        )
        stack.enter_context(patch.object(httpx.HTTPTransport, "handle_request", guard.sync_request))
        stack.enter_context(
            patch.object(httpx.AsyncHTTPTransport, "handle_async_request", guard.async_request)
        )
        settings = Settings(
            _env_file=None,
            environment="test",
            database_url=f"sqlite:///{temporary / 'verification.db'}",
            policy_dir=ROOT / "policies",
            api_key=SecretStr(secrets.token_urlsafe(32)),
            reviewer_api_key=SecretStr(secrets.token_urlsafe(32)),
            llm_provider="demo",
            execution_mode="dry_run",
            openai_api_key=None,
            paypal_client_id="",
            paypal_client_secret=None,
        )
        app = create_app(settings)
        require(
            type(app.state.coordinator.extractor) is DemoExtractor,
            "The configured extractor is not the actual deterministic DemoExtractor",
        )
        with TestClient(app) as client:
            result = verify(Harness(client))
        require(guard.attempts == 0, "The internal workflow attempted an external HTTP call")
    report = {
        "status": "passed",
        "verified_at": datetime.now(UTC).isoformat(),
        "scope": "Synthetic policy mechanics through actual FastAPI routes, durable worker, and isolated clingo solver",
        "execution_environment": {
            "database": "isolated temporary SQLite, deleted after verification",
            "extractor": "DemoExtractor",
            "solver": "clingo",
            "solver_version": clingo.__version__,
            "execution_mode": "dry_run",
            "outbound_http_attempts": guard.attempts,
            "network_http_transports_blocked": True,
            "environment_configuration_ignored": True,
            "frontend_fixture_replay_used": False,
            "solver_mocked": False,
        },
        **result,
        "limitations": [
            "The bundled policy and FACT markers are synthetic; these cases are not real PayPal legal determinations.",
            "OpenAI extraction, PayPal Sandbox/live requests, and real webhook delivery are not exercised.",
            "A merchant evidence response does not establish buyer fraud, win probability, recovered revenue, or a resolved dispute.",
        ],
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n")
    print(
        f"PASS: {report['actual_analysis_runs']} real analysis runs; {report['actual_clingo_solver_attempts']} clingo attempts; 0 external HTTP calls."
    )
    for name, scenario in report["scenarios"].items():
        print(
            f"  {name}: {scenario['solver_status']} -> {scenario['recommended_action'] or 'human decision'} (version {scenario['case_version']})"
        )
    print(f"Verified evidence written to {args.output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
