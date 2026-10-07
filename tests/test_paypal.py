import asyncio
import hashlib
import json
from datetime import UTC, datetime, timedelta

import httpx
import pytest
from pydantic import SecretStr

from disputeflow.config import Settings
from disputeflow.domain import Action
from disputeflow.paypal import (
    PayPalClient,
    PayPalError,
    available_actions,
    normalized_case,
    validate_action_payload,
)

DISPUTE_ID = "PP-D-27803"
BASE = "https://api-m.sandbox.paypal.com"


def settings(**overrides):
    values = {
        "paypal_client_id": "test-client",
        "paypal_client_secret": SecretStr("test-client-secret"),
        "paypal_environment": "sandbox",
        "execution_mode": "sandbox",
        "paypal_webhook_id": "WH-TEST-ID",
    }
    values.update(overrides)
    return Settings(_env_file=None, **values)


def snapshot(action=Action.ACCEPT_CLAIM):
    return {
        "dispute_id": DISPUTE_ID,
        "reason": "MERCHANDISE_OR_SERVICE_NOT_RECEIVED",
        "status": "WAITING_FOR_SELLER_RESPONSE",
        "dispute_life_cycle_stage": "INQUIRY",
        "dispute_amount": {"currency_code": "USD", "value": "30.00"},
        "allowed_response_options": {
            "make_offer": {"offer_types": ["REFUND"]},
            "accept_claim": {"accept_claim_types": ["REFUND", "PARTIAL_REFUND"]},
        },
        "links": [
            {
                "rel": action.value.replace("_", "-"),
                "method": "POST",
                "href": f"{BASE}/v1/customer/disputes/{DISPUTE_ID}/{action.value.replace('_', '-')}",
            }
        ],
    }


def oauth():
    return httpx.Response(200, json={"access_token": "secret-access-token", "expires_in": 300})


@pytest.mark.parametrize(
    "action,payload",
    [
        (Action.ACCEPT_CLAIM, {"note": "Full refund to the customer."}),
        (
            Action.PROVIDE_EVIDENCE,
            {"evidences": [{"evidence_type": "OTHER", "notes": "Delivery was confirmed."}]},
        ),
        (
            Action.MAKE_OFFER,
            {
                "note": "Refund offer",
                "offer_type": "REFUND",
                "offer_amount": {"currency_code": "USD", "value": "20.00"},
            },
        ),
        (Action.ESCALATE, {"note": "Please review the disputed transaction."}),
        (Action.SEND_MESSAGE, {"message": "Shipment is in progress."}),
    ],
)
async def test_actions_refresh_state_and_submit_once_without_claiming_provider_idempotency(
    action, payload
):
    requests = []

    def handler(request):
        requests.append(request)
        assert str(request.url).startswith(BASE)
        if request.url.path == "/v1/oauth2/token":
            assert request.headers["authorization"].startswith("Basic ")
            assert request.content == b"grant_type=client_credentials"
            return oauth()
        assert request.headers["authorization"] == "Bearer secret-access-token"
        if request.method == "GET":
            return httpx.Response(200, json=snapshot(action))
        assert "paypal-request-id" not in request.headers
        assert json.loads(request.content) == payload
        return httpx.Response(200, json={"links": []})

    async with httpx.AsyncClient(
        transport=httpx.MockTransport(handler), base_url="https://untrusted.example"
    ) as transport:
        client = PayPalClient(settings(), transport)
        result = await client.execute(DISPUTE_ID, action, payload, "local-request-001")
        assert result == {"links": []}
        assert [r.method for r in requests] == ["POST", "GET", "POST"]
        await client.close()
        assert not transport.is_closed


async def test_oauth_is_cached_under_concurrent_reads():
    tokens = 0

    async def handler(request):
        nonlocal tokens
        if request.url.path == "/v1/oauth2/token":
            tokens += 1
            await asyncio.sleep(0)
            return oauth()
        return httpx.Response(200, json=snapshot())

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as transport:
        client = PayPalClient(settings(), transport)
        await asyncio.gather(*(client.get_dispute(DISPUTE_ID) for _ in range(10)))
        assert tokens == 1


async def test_expired_token_refreshes():
    tokens = 0

    def handler(request):
        nonlocal tokens
        if request.url.path == "/v1/oauth2/token":
            tokens += 1
            return oauth()
        return httpx.Response(200, json=snapshot())

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as transport:
        client = PayPalClient(settings(), transport)
        await client.get_dispute(DISPUTE_ID)
        client._token_expiry = 0
        await client.get_dispute(DISPUTE_ID)
        assert tokens == 2


async def test_reads_and_oauth_retry_transient_errors_with_bounded_retry_after(monkeypatch):
    counts = {"token": 0, "get": 0}
    delays = []

    async def sleep(delay):
        delays.append(delay)

    monkeypatch.setattr("disputeflow.paypal.asyncio.sleep", sleep)

    def handler(request):
        key = "token" if request.url.path == "/v1/oauth2/token" else "get"
        counts[key] += 1
        if counts[key] <= 2:
            return httpx.Response(
                429, headers={"Retry-After": "0.1"}, json={"name": "RATE_LIMIT_REACHED"}
            )
        return oauth() if key == "token" else httpx.Response(200, json=snapshot())

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as transport:
        await PayPalClient(settings(), transport).get_dispute(DISPUTE_ID)
        assert counts == {"token": 3, "get": 3}
        assert delays == [0.1] * 4


async def test_long_retry_after_defers_to_caller_without_retrying_early():
    attempts = 0

    def handler(request):
        nonlocal attempts
        attempts += 1
        return httpx.Response(
            429, headers={"Retry-After": "10000"}, json={"name": "RATE_LIMIT_REACHED"}
        )

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as transport:
        with pytest.raises(PayPalError) as failure:
            await PayPalClient(settings(), transport).get_dispute(DISPUTE_ID)
        assert failure.value.status_code == 429
        assert attempts == 1


@pytest.mark.parametrize("failure", ["timeout", "server", "invalid_json"])
async def test_write_failures_are_uncertain_and_never_retried(failure):
    writes = 0

    def handler(request):
        nonlocal writes
        if request.url.path == "/v1/oauth2/token":
            return oauth()
        if request.method == "GET":
            return httpx.Response(200, json=snapshot())
        writes += 1
        if failure == "timeout":
            raise httpx.ReadTimeout("secret-access-token leaked by transport", request=request)
        if failure == "invalid_json":
            return httpx.Response(200, text="secret-client-secret")
        return httpx.Response(
            503,
            json={
                "name": "INTERNAL_SERVER_ERROR",
                "message": "secret-access-token",
                "debug_id": "debug-123",
            },
        )

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as transport:
        with pytest.raises(PayPalError) as failure_info:
            await PayPalClient(settings(), transport).execute(
                DISPUTE_ID, Action.ACCEPT_CLAIM, {"note": "Refund"}, "request-1"
            )
        assert failure_info.value.uncertain
        assert "secret" not in str(failure_info.value)
        assert writes == 1


async def test_write_401_does_not_retry_the_action():
    writes = 0

    def handler(request):
        nonlocal writes
        if request.url.path == "/v1/oauth2/token":
            return oauth()
        if request.method == "GET":
            return httpx.Response(200, json=snapshot())
        writes += 1
        return httpx.Response(401, json={"name": "AUTHENTICATION_FAILURE"})

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as transport:
        with pytest.raises(PayPalError) as failure_info:
            await PayPalClient(settings(), transport).execute(
                DISPUTE_ID, Action.ACCEPT_CLAIM, {"note": "Refund"}, "request-1"
            )
        assert not failure_info.value.uncertain
        assert writes == 1


@pytest.mark.parametrize(
    "link_change",
    [
        {"href": "https://evil.example/action"},
        {"method": "GET"},
        {"href": f"{BASE}/v1/customer/disputes/OTHER/accept-claim"},
        {"href": f"{BASE}/v1/customer/disputes/{DISPUTE_ID}/accept-claim?redirect=1"},
        {"href": f"https://api-m.paypal.com/v1/customer/disputes/{DISPUTE_ID}/accept-claim"},
    ],
)
async def test_fresh_hateoas_must_match_action_dispute_and_environment(link_change):
    writes = 0
    value = snapshot()
    value["links"][0].update(link_change)

    def handler(request):
        nonlocal writes
        if request.url.path == "/v1/oauth2/token":
            return oauth()
        if request.method == "GET":
            return httpx.Response(200, json=value)
        writes += 1
        return httpx.Response(200, json={})

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as transport:
        with pytest.raises(PayPalError, match="no longer available"):
            await PayPalClient(settings(), transport).execute(
                DISPUTE_ID, Action.ACCEPT_CLAIM, {"note": "Refund"}, "request-1"
            )
        assert writes == 0


async def test_dry_run_never_calls_provider():
    def handler(request):
        pytest.fail("dry-run attempted a provider call")

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as transport:
        with pytest.raises(PayPalError) as failure:
            await PayPalClient(settings(execution_mode="dry_run"), transport).execute(
                DISPUTE_ID, Action.ACCEPT_CLAIM, {"note": "Refund"}, "request-1"
            )
        assert failure.value.code == "PAYPAL_EXECUTION_DISABLED"


@pytest.mark.parametrize("changed", [False, True])
async def test_execution_binds_fresh_provider_state_to_the_reviewed_snapshot(changed):
    original = snapshot()
    expected_hash = hashlib.sha256(
        json.dumps(original, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()
    ).hexdigest()
    current = snapshot()
    if changed:
        current["status"] = "WAITING_FOR_BUYER_RESPONSE"
    writes = []

    def handler(request):
        if request.url.path == "/v1/oauth2/token":
            return oauth()
        if request.method == "GET":
            return httpx.Response(200, json=current)
        writes.append(request)
        return httpx.Response(200, json={"links": []})

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as transport:
        client = PayPalClient(settings(), transport)
        if changed:
            with pytest.raises(PayPalError) as failure:
                await client.execute(
                    DISPUTE_ID,
                    Action.ACCEPT_CLAIM,
                    {"note": "Refund"},
                    "request-1",
                    expected_snapshot_hash=expected_hash,
                )
            assert failure.value.status_code == 409
            assert failure.value.code == "STALE_DISPUTE"
            assert not failure.value.uncertain
            assert not writes
        else:
            await client.execute(
                DISPUTE_ID,
                Action.ACCEPT_CLAIM,
                {"note": "Refund"},
                "request-1",
                expected_snapshot_hash=expected_hash,
            )
            assert len(writes) == 1


@pytest.mark.parametrize("identifier", ["../secret", "PP-D-1?token=x", "", "a" * 256])
async def test_dispute_ids_reject_path_injection_before_oauth(identifier):
    def handler(request):
        pytest.fail("invalid ID attempted a network request")

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as transport:
        with pytest.raises(PayPalError):
            await PayPalClient(settings(), transport).get_dispute(identifier)


@pytest.mark.parametrize(
    "action,payload",
    [
        (
            Action.ACCEPT_CLAIM,
            {"note": "Refund", "refund_amount": {"currency_code": "USD", "value": "1"}},
        ),
        (Action.ACCEPT_CLAIM, {"note": "Refund", "accept_claim_type": []}),
        (Action.MAKE_OFFER, {"note": "Refund", "offer_type": []}),
        (Action.MAKE_OFFER, {"note": "Refund", "offer_type": "REFUND"}),
        (
            Action.MAKE_OFFER,
            {
                "note": "Refund",
                "offer_type": "REFUND",
                "offer_amount": {"currency_code": "USD", "value": "-1"},
            },
        ),
        (
            Action.MAKE_OFFER,
            {
                "note": "Refund",
                "offer_type": "REFUND",
                "offer_amount": {"currency_code": "USD", "value": "1.001"},
            },
        ),
        (
            Action.MAKE_OFFER,
            {
                "note": "Refund",
                "offer_type": "REFUND",
                "offer_amount": {"currency_code": "JPY", "value": "1.00"},
            },
        ),
        (
            Action.MAKE_OFFER,
            {
                "note": "Refund",
                "offer_type": "REPLACEMENT_WITHOUT_REFUND",
                "offer_amount": {"currency_code": "USD", "value": "1"},
            },
        ),
        (
            Action.PROVIDE_EVIDENCE,
            {
                "evidences": [
                    {"evidence_type": "OTHER", "documents": [{"name": "not-uploaded.pdf"}]}
                ]
            },
        ),
        (
            Action.PROVIDE_EVIDENCE,
            {"evidences": [{"evidence_type": "PROOF_OF_REFUND", "notes": "No refund ID"}]},
        ),
        (Action.PROVIDE_EVIDENCE, {"evidences": [{"evidence_type": "MADE_UP", "notes": "Claim"}]}),
        (Action.SEND_MESSAGE, {"content": "Wrong schema"}),
        (Action.ESCALATE, {"note": ""}),
        (Action.NO_ACTION, {}),
    ],
)
def test_payload_schema_rejects_invalid_types_money_and_phantom_documents(action, payload):
    with pytest.raises(PayPalError):
        validate_action_payload(action, payload)


async def test_offer_checks_provider_allowed_types_and_disputed_amount():
    payloads = [
        {
            "note": "Offer",
            "offer_type": "REFUND_WITH_REPLACEMENT",
            "offer_amount": {"currency_code": "USD", "value": "10"},
        },
        {
            "note": "Offer",
            "offer_type": "REFUND",
            "offer_amount": {"currency_code": "EUR", "value": "10"},
        },
        {
            "note": "Offer",
            "offer_type": "REFUND",
            "offer_amount": {"currency_code": "USD", "value": "31"},
        },
    ]

    def handler(request):
        if request.url.path == "/v1/oauth2/token":
            return oauth()
        assert request.method == "GET"
        return httpx.Response(200, json=snapshot(Action.MAKE_OFFER))

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as transport:
        for payload in payloads:
            with pytest.raises(PayPalError):
                await PayPalClient(settings(), transport).execute(
                    DISPUTE_ID, Action.MAKE_OFFER, payload, "request-1"
                )


def webhook_headers():
    return {
        "PAYPAL-AUTH-ALGO": "SHA256withRSA",
        "PAYPAL-CERT-URL": f"{BASE}/v1/notifications/certs/CERT-1",
        "PAYPAL-TRANSMISSION-ID": "transmission-1",
        "PAYPAL-TRANSMISSION-SIG": "signed-payload",
        "PAYPAL-TRANSMISSION-TIME": "2026-10-05T12:00:00Z",
    }


@pytest.mark.parametrize(
    "status,result", [("SUCCESS", True), ("FAILURE", False), ("UNKNOWN", False)]
)
async def test_webhook_verification_uses_paypal_remote_verifier(status, result):
    paths = []
    event = {"id": "WH-EVENT-1", "event_type": "CUSTOMER.DISPUTE.CREATED"}

    def handler(request):
        paths.append(request.url.path)
        if request.url.path == "/v1/oauth2/token":
            return oauth()
        assert request.url.path == "/v1/notifications/verify-webhook-signature"
        payload = json.loads(request.content)
        assert payload["webhook_id"] == "WH-TEST-ID"
        assert payload["webhook_event"] == event
        assert payload["cert_url"] == webhook_headers()["PAYPAL-CERT-URL"]
        return httpx.Response(200, json={"verification_status": status})

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as transport:
        assert (
            await PayPalClient(settings(), transport).verify_webhook(webhook_headers(), event)
            is result
        )
        assert len(paths) == 2


@pytest.mark.parametrize(
    "cert",
    [
        "http://api-m.sandbox.paypal.com/v1/notifications/certs/1",
        "https://api-m.sandbox.paypal.com.evil.example/v1/notifications/certs/1",
        "https://evil.example/v1/notifications/certs/1",
        "https://user:pass@api-m.sandbox.paypal.com/v1/notifications/certs/1",
        "https://api-m.sandbox.paypal.com:8443/v1/notifications/certs/1",
    ],
)
async def test_webhook_cert_rejects_untrusted_urls_without_fetching(cert):
    def handler(request):
        pytest.fail("untrusted webhook attempted network I/O")

    headers = webhook_headers()
    headers["PAYPAL-CERT-URL"] = cert
    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as transport:
        assert not await PayPalClient(settings(), transport).verify_webhook(
            headers, {"id": "event-1"}
        )


async def test_webhook_fails_closed_for_missing_headers_or_configuration():
    def handler(request):
        pytest.fail("invalid webhook attempted network I/O")

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as transport:
        assert not await PayPalClient(settings(), transport).verify_webhook({}, {"id": "event-1"})
        with pytest.raises(PayPalError) as failure:
            await PayPalClient(settings(paypal_webhook_id=""), transport).verify_webhook(
                webhook_headers(), {"id": "event-1"}
            )
        assert failure.value.code == "PAYPAL_WEBHOOK_NOT_CONFIGURED"


async def test_list_queries_encode_tokens_and_validate_bounds():
    token = "abc+/="

    def handler(request):
        if request.url.path == "/v1/oauth2/token":
            return oauth()
        assert request.url.params["next_page_token"] == token
        assert request.url.params["page_size"] == "50"
        return httpx.Response(200, json={"items": []})

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as transport:
        client = PayPalClient(settings(), transport)
        assert await client.list_disputes(page_size=50, next_page_token=token) == {"items": []}
        for kwargs in [
            {"page_size": 51},
            {"page_size": True},
            {"dispute_state": "MADE_UP"},
            {"start_time": "2026-01-01"},
            {"start_time": (datetime.now(UTC) - timedelta(days=181)).isoformat()},
            {"start_time": "2026-10-05T12:00:00Z", "disputed_transaction_id": "TRANSACTION"},
        ]:
            with pytest.raises(PayPalError):
                await client.list_disputes(**kwargs)


def test_case_normalization_preserves_unverified_provider_evidence():
    case = normalized_case(snapshot(), "demo_policy")
    assert case.external_id == DISPUTE_ID
    assert case.allowed_actions == [Action.ACCEPT_CLAIM]
    assert not case.evidence[0].verified
    assert not case.auto_execute
    forged = snapshot()
    forged["links"][0]["href"] = "https://evil.example"
    assert available_actions(forged) == []
