"""Static support and vocabulary checks must never rewrite the ASP theory."""

import pytest
from pydantic import ValidationError

from disputeflow.domain import (
    Action,
    ClauseCitation,
    Fact,
    KnowledgeBase,
    Literal,
    SolverResult,
)
from disputeflow.domain import Rule as RuleContract
from disputeflow.reasoning import compile_program, solve


def literal(name: str, negated: bool = False) -> Literal:
    return Literal(name=name, negated=negated)


def fact(name: str, negated: bool = False) -> Fact:
    return Fact(
        id=f"fact_{name}", literal=literal(name, negated), evidence_ids=[f"evidence_{name}"]
    )


def rule(
    identifier: str,
    head: str,
    *,
    body: list[Literal] | None = None,
    unless: list[Literal] | None = None,
    negated: bool = False,
    kind: str = "defeasible",
) -> RuleContract:
    return RuleContract(
        id=identifier,
        head=literal(head, negated),
        body=body or [],
        unless=unless or [],
        kind=kind,
        citations=[ClauseCitation(clause_id="delivery_clause", quote="Exact illustrative clause.")],
    )


def diagnostics(result: SolverResult, code: str):
    return [detail for detail in result.diagnostic_details if detail.code == code]


def test_delivery_vocabulary_drift_is_explicit_and_never_renamed():
    kb = KnowledgeBase(
        facts=[fact("delivery_confirmed")],
        rules=[
            rule(
                "respond_with_tracking",
                "decision_provide_evidence",
                body=[literal("delivery_verified")],
            )
        ],
    )
    result = solve(kb)
    assert result.status == "unique"
    assert result.models[0].decisions == []
    assert result.program == compile_program(kb)
    missing = diagnostics(result, "unreachable_premise")[0]
    assert missing.severity == "warning"
    assert missing.literals == ["delivery_verified"]
    assert missing.rule_ids == ["respond_with_tracking"]
    assert "delivery_confirmed" in missing.suggestions
    assert "No predicate was renamed" in missing.message
    assert diagnostics(result, "unreachable_rule")[0].severity == "warning"
    orphan = diagnostics(result, "noncontributing_fact")[0]
    assert orphan.fact_ids == ["fact_delivery_confirmed"]
    assert orphan.severity == "info"
    assert diagnostics(result, "no_executable_decision")[0].severity == "error"
    assert result.diagnostics == [detail.message for detail in result.diagnostic_details]


def test_diagnostics_are_in_proof_with_links_to_the_problematic_inputs():
    result = solve(
        KnowledgeBase(
            facts=[fact("delivery_confirmed")],
            rules=[
                rule("respond", "decision_provide_evidence", body=[literal("delivery_verified")])
            ],
        )
    )
    nodes = {node.id: node for node in result.proof.nodes}
    diagnostic_nodes = [node for node in nodes.values() if node.kind == "diagnostic"]
    assert len(diagnostic_nodes) == len(result.diagnostic_details)
    for node in diagnostic_nodes:
        assert any(
            edge.source == "reasoning" and edge.target == node.id and edge.relation == "diagnoses"
            for edge in result.proof.edges
        )
    concerns = {edge.target for edge in result.proof.edges if edge.relation == "concerns"}
    assert {"fact:fact_delivery_confirmed", "rule:respond", "literal:delivery_verified"} <= concerns
    assert all(edge.source in nodes and edge.target in nodes for edge in result.proof.edges)


def test_reachable_signed_chain_has_no_blocking_diagnostics():
    result = solve(
        KnowledgeBase(
            facts=[fact("delivered")],
            rules=[
                rule("derive", "eligible", body=[literal("delivered")], kind="strict"),
                rule("respond", "decision_provide_evidence", body=[literal("eligible")]),
            ],
        ),
        authoritative_vocabulary=["delivered", "eligible"],
    )
    assert result.models[0].decisions == [Action.PROVIDE_EVIDENCE]
    assert result.diagnostic_details == []


def test_opposite_signed_fact_does_not_supply_a_positive_premise():
    result = solve(
        KnowledgeBase(
            facts=[fact("delivered", negated=True)],
            rules=[rule("respond", "decision_provide_evidence", body=[literal("delivered")])],
        )
    )
    assert diagnostics(result, "unreachable_premise")[0].literals == ["delivered"]


def test_negated_premise_is_reachable_from_the_same_signed_fact():
    result = solve(
        KnowledgeBase(
            facts=[fact("delivered", negated=True)],
            rules=[rule("respond", "decision_accept_claim", body=[literal("delivered", True)])],
        )
    )
    assert result.models[0].decisions == [Action.ACCEPT_CLAIM]
    assert not diagnostics(result, "unreachable_premise")
    assert not diagnostics(result, "noncontributing_fact")


def test_unseeded_cycle_is_not_reachable():
    result = solve(
        KnowledgeBase(
            rules=[
                rule("first", "a", body=[literal("b")]),
                rule("second", "b", body=[literal("a")]),
                rule("respond", "decision_accept_claim", body=[literal("a")]),
            ]
        )
    )
    assert {detail.rule_ids[0] for detail in diagnostics(result, "unreachable_rule")} == {
        "first",
        "second",
        "respond",
    }
    assert {detail.literals[0] for detail in diagnostics(result, "unreachable_premise")} == {
        "a",
        "b",
    }


def test_defeater_head_is_not_a_source_for_other_rules():
    result = solve(
        KnowledgeBase(
            facts=[fact("delivered")],
            rules=[
                rule("block", "eligible", body=[literal("delivered")], kind="defeater"),
                rule("respond", "decision_provide_evidence", body=[literal("eligible")]),
            ],
        )
    )
    assert diagnostics(result, "unreachable_premise")[0].literals == ["eligible"]
    assert result.models[0].decisions == []


def test_absent_default_negated_exception_is_not_an_unreachable_premise():
    result = solve(
        KnowledgeBase(
            facts=[fact("delivered")],
            rules=[
                rule(
                    "respond",
                    "decision_provide_evidence",
                    body=[literal("delivered")],
                    unless=[literal("tracking_invalid")],
                )
            ],
        )
    )
    assert result.models[0].decisions == [Action.PROVIDE_EVIDENCE]
    assert not diagnostics(result, "unreachable_premise")
    assert not diagnostics(result, "unreachable_rule")


def test_exception_fact_contributes_even_when_it_blocks_a_decision():
    result = solve(
        KnowledgeBase(
            facts=[fact("delivered"), fact("tracking_invalid")],
            rules=[
                rule(
                    "respond",
                    "decision_provide_evidence",
                    body=[literal("delivered")],
                    unless=[literal("tracking_invalid")],
                )
            ],
        )
    )
    assert not diagnostics(result, "noncontributing_fact")
    assert diagnostics(result, "no_executable_decision")


def test_fact_used_only_by_an_irrelevant_chain_is_informative():
    result = solve(
        KnowledgeBase(
            facts=[fact("delivered"), fact("marketing_opt_in")],
            rules=[
                rule("respond", "decision_provide_evidence", body=[literal("delivered")]),
                rule("marketing", "newsletter_eligible", body=[literal("marketing_opt_in")]),
            ],
        )
    )
    irrelevant = diagnostics(result, "noncontributing_fact")
    assert len(irrelevant) == 1
    assert irrelevant[0].fact_ids == ["fact_marketing_opt_in"]
    assert irrelevant[0].severity == "info"


def test_defeater_and_opposing_rule_premises_contribute_to_decisions():
    result = solve(
        KnowledgeBase(
            facts=[fact("delivered"), fact("suspicious_tracking"), fact("return_received")],
            rules=[
                rule("respond", "decision_provide_evidence", body=[literal("delivered")]),
                rule(
                    "block",
                    "decision_provide_evidence",
                    negated=True,
                    body=[literal("suspicious_tracking")],
                    kind="defeater",
                ),
                rule(
                    "opposition",
                    "decision_provide_evidence",
                    negated=True,
                    body=[literal("return_received")],
                ),
            ],
        )
    )
    assert not diagnostics(result, "noncontributing_fact")


def test_vocabulary_unknowns_include_exceptions_but_reserve_action_atoms():
    result = solve(
        KnowledgeBase(
            facts=[fact("delivery_confirmed")],
            rules=[
                rule(
                    "respond",
                    "decision_provide_evidence",
                    body=[literal("delivery_confirmed")],
                    unless=[literal("unapproved_exception")],
                )
            ],
        ),
        authoritative_vocabulary=["delivery_verified"],
    )
    unknown = diagnostics(result, "unknown_predicate")
    assert {detail.literals[0] for detail in unknown} == {
        "delivery_confirmed",
        "unapproved_exception",
    }
    assert all(detail.severity == "error" for detail in unknown)
    delivery = next(detail for detail in unknown if "delivery_confirmed" in detail.literals)
    assert delivery.fact_ids == ["fact_delivery_confirmed"]
    assert delivery.rule_ids == ["respond"]
    assert delivery.suggestions == ["delivery_verified"]
    # Diagnostics block automation through governance, but never alter entailment.
    assert result.models[0].decisions == [Action.PROVIDE_EVIDENCE]


def test_omitted_and_empty_author_vocabulary_have_distinct_meanings():
    kb = KnowledgeBase(
        facts=[fact("delivered")],
        rules=[rule("respond", "decision_provide_evidence", body=[literal("delivered")])],
    )
    missing = solve(kb)
    assert diagnostics(missing, "vocabulary_not_configured")[0].severity == "info"
    assert not diagnostics(missing, "unknown_predicate")
    empty = solve(kb, authoritative_vocabulary=[])
    assert diagnostics(empty, "unknown_predicate")[0].literals == ["delivered"]


def test_extractor_cannot_define_its_own_vocabulary():
    with pytest.raises(ValidationError, match="Extra inputs are not permitted"):
        KnowledgeBase.model_validate({"authoritative_vocabulary": ["anything"]})
    with pytest.raises(ValidationError):
        solve(KnowledgeBase(), authoritative_vocabulary=["bad). injected. %"])


def test_no_action_and_empty_theories_do_not_establish_an_executable_decision():
    for kb in (
        KnowledgeBase(),
        KnowledgeBase(rules=[rule("wait", "decision_no_action")]),
    ):
        result = solve(kb)
        assert result.status == "unique"
        assert diagnostics(result, "no_executable_decision")[0].severity == "error"


def test_diagnostics_are_deterministic_across_input_reordering():
    facts = [fact("delivery_confirmed"), fact("marketing_opt_in")]
    rules = [
        rule("respond", "decision_provide_evidence", body=[literal("delivery_verified")]),
        rule("irrelevant", "marketing_eligible", body=[literal("marketing_opt_in")]),
    ]
    first = solve(KnowledgeBase(facts=facts, rules=rules), authoritative_vocabulary=["delivered"])
    second = solve(
        KnowledgeBase(facts=list(reversed(facts)), rules=list(reversed(rules))),
        authoritative_vocabulary=["delivered"],
    )
    assert first.diagnostic_details == second.diagnostic_details
    assert first.proof == second.proof


def test_legacy_solver_result_payload_remains_readable():
    result = solve(KnowledgeBase())
    legacy = result.model_dump(mode="json")
    del legacy["diagnostic_details"]
    assert SolverResult.model_validate(legacy).diagnostic_details == []
