from __future__ import annotations

import json
from pathlib import Path

import httpx
import pytest
from pydantic import SecretStr

from disputeflow.config import Settings
from disputeflow.domain import Action, CaseInput, KnowledgeBase
from disputeflow.llm import (
    DemoExtractor,
    ExtractionError,
    GroundingError,
    LLMError,
    OpenAIExtractor,
    _strict_schema,
    validate_grounding,
)
from disputeflow.policy import PolicyCatalog
from disputeflow.reasoning.solver import solve

ROOT = Path(__file__).resolve().parents[1]


async def bundle(name="unique.json"):
    case = CaseInput.model_validate_json((ROOT / "examples" / name).read_text())
    retrieval = await PolicyCatalog(ROOT / "policies").retrieve(case, DemoExtractor())
    knowledge = await DemoExtractor().extract(case, retrieval)
    return case, retrieval, knowledge


def settings():
    return Settings(
        llm_provider="openai",
        openai_api_key=SecretStr("fake-test-key"),
        openai_model="explicit-test-model",
        _env_file=None,
    )


def envelope(payload):
    return {
        "status": "completed",
        "output": [
            {"type": "message", "content": [{"type": "output_text", "text": json.dumps(payload)}]}
        ],
    }


@pytest.mark.asyncio
async def test_demo_facts_and_rules_have_exact_provenance():
    case, retrieval, knowledge = await bundle()
    validate_grounding(knowledge, case, retrieval)
    facts = {fact.literal.name: fact for fact in knowledge.facts}
    assert facts["delivery_verified"].evidence_ids == ["carrier_record"]
    assert facts["claim_nonreceipt"].evidence_ids == ["buyer_statement"]
    assert {(priority.higher, priority.lower) for priority in knowledge.priorities} == {
        ("seller_delivery", "buyer_nonreceipt"),
        ("invalid_tracking", "seller_delivery"),
    }
    assert "not actual PayPal" in knowledge.warnings[0]


@pytest.mark.asyncio
async def test_grounding_rejects_missing_evidence_and_fabricated_quotation():
    case, retrieval, knowledge = await bundle()
    altered = knowledge.model_copy(deep=True)
    altered.facts[0].evidence_ids = ["fabricated_evidence"]
    with pytest.raises(GroundingError, match="unavailable evidence"):
        validate_grounding(altered, case, retrieval)
    altered = knowledge.model_copy(deep=True)
    altered.rules[0].citations[0].quote = "PayPal always refunds all buyers."
    with pytest.raises(GroundingError, match="exact substring"):
        validate_grounding(altered, case, retrieval)
    altered = knowledge.model_copy(deep=True)
    altered.facts[0].literal.name = "decision_accept_claim"
    with pytest.raises(GroundingError, match="Decisions must derive"):
        validate_grounding(altered, case, retrieval)
    altered_retrieval = retrieval.model_copy(deep=True)
    altered_retrieval.clauses[0].sha256 = "0" * 64
    with pytest.raises(GroundingError, match="invalid source hash"):
        validate_grounding(knowledge, case, altered_retrieval)


@pytest.mark.asyncio
async def test_demo_never_uses_unverified_evidence_or_other_policy():
    case, retrieval, _ = await bundle()
    case.evidence[0].verified = False
    knowledge = await DemoExtractor().extract(case, retrieval)
    assert all(fact.literal.name != "claim_nonreceipt" for fact in knowledge.facts)
    assert any("Unverified evidence" in warning for warning in knowledge.warnings)
    retrieval.synthetic = False
    with pytest.raises(ExtractionError, match="bundled synthetic"):
        await DemoExtractor().extract(case, retrieval)


@pytest.mark.asyncio
async def test_demo_rejects_a_spoofed_fixture_clause():
    case, retrieval, _ = await bundle()
    retrieval.clauses[0].text = "Spoofed policy with unrelated semantics."
    with pytest.raises(ExtractionError, match="fixture text"):
        await DemoExtractor().extract(case, retrieval)


@pytest.mark.asyncio
async def test_correction_keeps_conflicting_verified_evidence():
    case, retrieval, previous = await bundle("inconsistent.json")
    corrected = await DemoExtractor().extract(
        case, retrieval, previous=previous, diagnostics=["No answer sets"]
    )
    assert corrected.facts == previous.facts
    assert {fact.literal.key() for fact in corrected.facts} >= {
        "delivery_verified",
        "-delivery_verified",
    }
    assert any("Self-correction retained" in warning for warning in corrected.warnings)


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("fixture", "status", "decisions"),
    [
        ("unique.json", "unique", {Action.PROVIDE_EVIDENCE}),
        ("ambiguous.json", "multiple", {Action.ACCEPT_CLAIM, Action.PROVIDE_EVIDENCE}),
        ("inconsistent.json", "inconsistent", set()),
        ("nonmonotonic-after.json", "unique", {Action.ACCEPT_CLAIM}),
    ],
)
async def test_demo_fixtures_compute_expected_asp_extensions(fixture, status, decisions):
    _, _, knowledge = await bundle(fixture)
    result = solve(knowledge)
    assert result.status == status
    assert {decision for model in result.models for decision in model.decisions} == decisions


@pytest.mark.asyncio
async def test_openai_sends_strict_schema_store_false_and_configured_model():
    case, retrieval, knowledge = await bundle()
    requests = []

    async def handler(request):
        requests.append(json.loads(request.content))
        assert request.headers["authorization"] == "Bearer fake-test-key"
        return httpx.Response(200, json=envelope(knowledge.model_dump(mode="json")))

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        result = await OpenAIExtractor(settings(), client).extract(
            case, retrieval, previous=knowledge, diagnostics=["repair required"]
        )
    assert result == knowledge
    body = requests[0]
    assert body["model"] == "explicit-test-model"
    assert body["store"] is False
    assert body["text"]["format"]["strict"] is True
    assert body["text"]["format"]["schema"]["required"] == [
        "facts",
        "rules",
        "priorities",
        "confidence",
        "warnings",
    ]
    assert json.loads(body["input"][0]["content"])["solver_diagnostics"] == ["repair required"]


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("response", "message"),
    [
        ({"status": "incomplete", "output": []}, "incomplete"),
        (
            {
                "status": "completed",
                "output": [
                    {"type": "message", "content": [{"type": "refusal", "refusal": "Rejected"}]}
                ],
            },
            "refused",
        ),
        (
            {
                "status": "completed",
                "output": [
                    {"type": "message", "content": [{"type": "output_text", "text": "not json"}]}
                ],
            },
            "malformed JSON",
        ),
        (envelope({"raw_asp": "#show attack/1."}), "knowledge-base contract"),
        ({"status": "completed", "output": []}, "exactly one"),
        (
            {
                "status": "completed",
                "output": [{"type": "message", "content": [{"type": "output_text", "text": "[]"}]}],
            },
            "JSON object",
        ),
    ],
)
async def test_openai_fails_explicitly_for_invalid_or_refused_output(response, message):
    case, retrieval, _ = await bundle()
    async with httpx.AsyncClient(
        transport=httpx.MockTransport(lambda request: httpx.Response(200, json=response))
    ) as client:
        with pytest.raises(LLMError, match=message):
            await OpenAIExtractor(settings(), client).extract(case, retrieval)


@pytest.mark.asyncio
async def test_openai_timeout_and_http_errors_do_not_surface_remote_body():
    case, retrieval, _ = await bundle()

    def timeout(request):
        raise httpx.ReadTimeout("secret upstream debug context", request=request)

    async with httpx.AsyncClient(transport=httpx.MockTransport(timeout)) as client:
        with pytest.raises(LLMError, match="timed out") as exc:
            await OpenAIExtractor(settings(), client).extract(case, retrieval)
        assert "secret" not in str(exc.value)
    async with httpx.AsyncClient(
        transport=httpx.MockTransport(
            lambda request: httpx.Response(429, text="sensitive upstream body")
        )
    ) as client:
        with pytest.raises(LLMError, match="HTTP 429") as exc:
            await OpenAIExtractor(settings(), client).extract(case, retrieval)
        assert "sensitive" not in str(exc.value)


@pytest.mark.asyncio
async def test_live_toc_navigation_uses_current_level_enum_only():
    case, _, _ = await bundle()
    headings = PolicyCatalog(ROOT / "policies").toc("demo_policy")
    requests = []

    def handler(request):
        requests.append(json.loads(request.content))
        return httpx.Response(200, json=envelope({"section_ids": ["nonreceipt", "contest_action"]}))

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        selected = await OpenAIExtractor(settings(), client).select_sections(case, headings, [])
    assert selected == ["nonreceipt", "contest_action"]
    enum = requests[0]["text"]["format"]["schema"]["properties"]["section_ids"]["items"]["enum"]
    assert "nonreceipt" in enum
    assert "seller_delivery" not in enum


def test_schema_conversion_requires_every_object_property():
    schema = _strict_schema(KnowledgeBase.model_json_schema())
    for value in [schema, *schema["$defs"].values()]:
        if value.get("type") == "object":
            assert set(value["required"]) == set(value["properties"])
            assert value["additionalProperties"] is False
    assert '"default"' not in json.dumps(schema)
