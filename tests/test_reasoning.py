"""Reasoning checks the semantics, provenance, and incomplete-search safeguards."""

import asyncio
import hashlib
import multiprocessing
import time

import pytest
from pydantic import ValidationError

from disputeflow.domain import Action, ClauseCitation, Fact, KnowledgeBase, Literal, Priority, Rule
from disputeflow.reasoning import SolverError, UnsupportedTheoryError, compile_program, solve


def lit(name: str, negated: bool = False) -> Literal:
    return Literal(name=name, negated=negated)


def cite() -> list[ClauseCitation]:
    return [ClauseCitation(clause_id="clause_1", quote="Illustrative policy provision.")]


def fact(name: str, negated: bool = False) -> Fact:
    return Fact(
        id=f"fact_{name}_{'negative' if negated else 'positive'}",
        literal=lit(name, negated),
        evidence_ids=[f"evidence_{name}"],
    )


def rule(
    identifier: str,
    name: str,
    *,
    negated: bool = False,
    body: list[Literal] | None = None,
    unless: list[Literal] | None = None,
    kind: str = "defeasible",
) -> Rule:
    return Rule(
        id=identifier,
        head=lit(name, negated),
        body=body or [],
        unless=unless or [],
        kind=kind,
        citations=cite(),
    )


def priority(higher: str, lower: str) -> Priority:
    return Priority(higher=higher, lower=lower, citations=cite())


def keys(literals: list[Literal]) -> set[str]:
    return {literal.key() for literal in literals}


def test_unique_model_with_strict_chain_and_decision_provenance():
    kb = KnowledgeBase(
        facts=[fact("delivered")],
        rules=[
            rule("delivery", "eligible", body=[lit("delivered")], kind="strict"),
            rule("decision", "decision_provide_evidence", body=[lit("eligible")]),
        ],
    )
    result = solve(kb)
    assert result.status == "unique"
    assert result.enumeration_complete
    assert keys(result.skeptical) == {"delivered", "eligible", "decision_provide_evidence"}
    assert result.models[0].decisions == [Action.PROVIDE_EVIDENCE]
    assert result.program_sha256 == hashlib.sha256(result.program.encode()).hexdigest()
    assert any(node.kind == "citation" and node.data["quote"] for node in result.proof.nodes)
    assert any(
        edge.source == "evidence:evidence_delivered" and edge.relation == "supports"
        for edge in result.proof.edges
    )
    assert any(
        edge.relation == "derives" and edge.target == "literal:decision_provide_evidence"
        for edge in result.proof.edges
    )


def test_equal_opposing_rules_have_two_consistent_extensions():
    result = solve(
        KnowledgeBase(
            facts=[fact("dispute")],
            rules=[
                rule("support", "liable", body=[lit("dispute")]),
                rule("oppose", "liable", negated=True, body=[lit("dispute")]),
            ],
        )
    )
    assert result.status == "multiple"
    assert len(result.models) == 2
    assert {frozenset(keys(model.literals)) for model in result.models} == {
        frozenset({"dispute", "liable"}),
        frozenset({"dispute", "-liable"}),
    }
    assert keys(result.skeptical) == {"dispute"}
    assert keys(result.credulous) == {"dispute", "liable", "-liable"}


def test_contradictory_facts_are_inconsistent():
    result = solve(KnowledgeBase(facts=[fact("delivered"), fact("delivered", True)]))
    assert result.status == "inconsistent"
    assert result.enumeration_complete
    assert result.models == result.skeptical == result.credulous == []
    assert any(edge.relation == "contradicts" for edge in result.proof.edges)


def test_contradictory_strict_conclusions_are_inconsistent():
    result = solve(
        KnowledgeBase(
            rules=[
                rule("strict_positive", "liable", kind="strict"),
                rule("strict_negative", "liable", negated=True, kind="strict"),
            ]
        )
    )
    assert result.status == "inconsistent"


def test_priority_overrides_opposing_rule():
    result = solve(
        KnowledgeBase(
            rules=[
                rule("general", "liable"),
                rule("exception", "liable", negated=True),
            ],
            priorities=[priority("exception", "general")],
        )
    )
    assert result.status == "unique"
    assert keys(result.skeptical) == {"-liable"}
    assert result.models[0].defeated_rules == ["general"]
    assert any(edge.relation == "overrides" for edge in result.proof.edges)


def test_priority_is_transitive():
    result = solve(
        KnowledgeBase(
            rules=[
                rule("highest", "liable"),
                rule("middle", "unrelated"),
                rule("lowest", "liable", negated=True),
            ],
            priorities=[priority("highest", "middle"), priority("middle", "lowest")],
        )
    )
    assert result.status == "unique"
    assert keys(result.skeptical) == {"liable", "unrelated"}


def test_priority_cycles_and_unknown_references_are_rejected():
    rules = [rule("support", "liable"), rule("oppose", "liable", negated=True)]
    with pytest.raises(ValidationError, match="acyclic"):
        KnowledgeBase(
            rules=rules, priorities=[priority("support", "oppose"), priority("oppose", "support")]
        )
    with pytest.raises(ValidationError, match="unknown"):
        KnowledgeBase(rules=rules, priorities=[priority("missing", "support")])


def test_new_evidence_retracts_default_conclusion():
    default = rule("seller_default", "decision_accept_claim", unless=[lit("delivered")])
    before = solve(KnowledgeBase(rules=[default]))
    after = solve(KnowledgeBase(facts=[fact("delivered")], rules=[default]))
    assert before.models[0].decisions == [Action.ACCEPT_CLAIM]
    assert after.models[0].decisions == []
    assert "decision_accept_claim" not in keys(after.credulous)


def test_defeater_blocks_without_deriving_its_head():
    result = solve(
        KnowledgeBase(
            rules=[
                rule("default", "liable"),
                rule("block", "liable", negated=True, kind="defeater"),
            ]
        )
    )
    assert result.status == "unique"
    assert result.models[0].literals == []
    assert result.models[0].applied_rules == ["block"]
    assert result.models[0].defeated_rules == ["default"]
    assert any(edge.relation == "blocks" for edge in result.proof.edges)
    assert not any(edge.relation == "derives" for edge in result.proof.edges)


def test_superior_rule_overrides_defeater():
    result = solve(
        KnowledgeBase(
            rules=[
                rule("default", "liable"),
                rule("block", "liable", negated=True, kind="defeater"),
            ],
            priorities=[priority("default", "block")],
        )
    )
    assert result.status == "unique"
    assert keys(result.skeptical) == {"liable"}
    assert result.models[0].defeated_rules == ["block"]


def test_strict_fact_overrides_defeasible_rule_and_priority():
    result = solve(
        KnowledgeBase(
            facts=[fact("liable")],
            rules=[
                rule("opposing", "liable", negated=True),
            ],
        )
    )
    assert result.status == "unique"
    assert result.models[0].defeated_rules == ["opposing"]
    assert keys(result.skeptical) == {"liable"}


def test_positive_recursion_cannot_create_unsupported_fact():
    result = solve(KnowledgeBase(rules=[rule("circular", "liable", body=[lit("liable")])]))
    assert result.status == "unique"
    assert result.models[0].literals == []
    assert result.models[0].applied_rules == []


def test_chained_defeasible_rules_preserve_multiple_models():
    result = solve(
        KnowledgeBase(
            rules=[
                rule("positive", "liable"),
                rule("negative", "liable", negated=True),
                rule("decision", "decision_accept_claim", body=[lit("liable")]),
            ]
        )
    )
    assert result.status == "multiple"
    assert sorted(len(model.decisions) for model in result.models) == [0, 1]


def test_input_order_does_not_change_program_models_or_proof():
    facts = [fact("dispute"), fact("delivered")]
    rules = [
        rule("support", "liable", body=[lit("dispute"), lit("delivered")]),
        rule("oppose", "liable", negated=True),
    ]
    first = solve(KnowledgeBase(facts=facts, rules=rules))
    reordered = [rules[1], rules[0].model_copy(update={"body": list(reversed(rules[0].body))})]
    second = solve(KnowledgeBase(facts=list(reversed(facts)), rules=reordered))
    assert first.program == second.program
    assert first.models == second.models
    assert first.proof == second.proof


def test_model_cap_never_claims_uniqueness_or_skeptical_entailment():
    result = solve(
        KnowledgeBase(
            facts=[fact("common")],
            rules=[
                rule("a_positive", "a"),
                rule("a_negative", "a", negated=True),
                rule("b_positive", "b"),
                rule("b_negative", "b", negated=True),
            ],
        ),
        max_models=2,
    )
    assert result.status == "truncated"
    assert not result.enumeration_complete
    assert len(result.models) == 2
    assert result.skeptical == []
    assert "common" in keys(result.credulous)


def test_exact_cap_can_still_complete():
    result = solve(KnowledgeBase(facts=[fact("common")]), max_models=1)
    assert result.status == "unique"
    assert result.enumeration_complete


def test_timeout_returns_no_established_decision_and_respects_deadline():
    started = time.monotonic()
    result = solve(
        KnowledgeBase(rules=[rule("decision", "decision_accept_claim")]), timeout_seconds=0.000001
    )
    assert result.status == "timeout"
    assert not result.enumeration_complete
    assert result.models == result.skeptical == []
    assert time.monotonic() - started < 1


def _slow_worker(connection, program, max_models):
    time.sleep(5)


def test_running_worker_is_terminated_at_deadline(monkeypatch):
    from disputeflow.reasoning import solver

    monkeypatch.setattr(solver, "enumerate_program", _slow_worker)
    children_before = {child.pid for child in multiprocessing.active_children()}
    started = time.monotonic()
    result = solve(KnowledgeBase(), timeout_seconds=0.2)
    assert result.status == "timeout"
    assert result.models == result.skeptical == []
    assert time.monotonic() - started < 2
    assert {child.pid for child in multiprocessing.active_children()} == children_before


def test_independent_actions_are_preserved_for_governance_to_review():
    result = solve(
        KnowledgeBase(
            rules=[
                rule("accept", "decision_accept_claim"),
                rule("offer", "decision_make_offer"),
            ]
        )
    )
    assert result.status == "unique"
    assert result.models[0].decisions == [Action.ACCEPT_CLAIM, Action.MAKE_OFFER]


@pytest.mark.asyncio
async def test_concurrent_thread_executor_calls_are_isolated():
    kb = KnowledgeBase(rules=[rule("accept", "decision_accept_claim")])
    results = await asyncio.gather(*(asyncio.to_thread(solve, kb) for _ in range(4)))
    assert all(result.status == "unique" for result in results)
    assert all(result.models == results[0].models for result in results)


def _failed_worker(connection, program, max_models):
    connection.send({"error": "RuntimeError: artificial infrastructure failure"})
    connection.close()


def test_worker_error_is_not_reported_as_logical_inconsistency(monkeypatch):
    from disputeflow.reasoning import solver

    monkeypatch.setattr(solver, "enumerate_program", _failed_worker)
    with pytest.raises(SolverError, match="infrastructure failure"):
        solve(KnowledgeBase())


def test_asp_injection_is_rejected_even_when_domain_validation_is_bypassed():
    with pytest.raises(ValidationError):
        lit("liable). injected. %")
    unsafe = Literal.model_construct(name="liable). injected. %", negated=False)
    kb = KnowledgeBase.model_construct(
        facts=[
            Fact.model_construct(
                id="safe_id", literal=unsafe, evidence_ids=["evidence_1"], confidence=1
            )
        ],
        rules=[],
        priorities=[],
        confidence=1,
        warnings=[],
    )
    with pytest.raises(ValidationError):
        compile_program(kb)


@pytest.mark.parametrize(
    "kwargs",
    [
        {"max_models": 0},
        {"max_models": True},
        {"timeout_seconds": 0},
        {"timeout_seconds": float("nan")},
    ],
)
def test_invalid_solver_limits_are_rejected(kwargs):
    with pytest.raises(ValueError):
        solve(KnowledgeBase(), **kwargs)


def test_superior_hold_defeats_delivery_argument_through_strict_continuation():
    result = solve(
        KnowledgeBase(
            rules=[
                rule("seller", "decision_accept_claim", negated=True),
                rule(
                    "contest",
                    "decision_provide_evidence",
                    kind="strict",
                    body=[lit("decision_accept_claim", True)],
                ),
                rule("hold", "decision_provide_evidence", negated=True),
            ],
            priorities=[priority("hold", "seller")],
        )
    )
    assert result.status == "unique"
    assert keys(result.skeptical) == {"-decision_provide_evidence"}
    assert result.models[0].applied_rules == ["hold"]
    assert result.models[0].defeated_rules == ["seller"]
    assert result.models[0].decisions == []


def test_opposing_strict_continuations_preserve_defeasible_alternatives():
    result = solve(
        KnowledgeBase(
            rules=[
                rule("seller", "delivery"),
                rule("buyer", "nonreceipt"),
                rule("delivered", "received", body=[lit("delivery")], kind="strict"),
                rule("missing", "received", negated=True, body=[lit("nonreceipt")], kind="strict"),
            ],
        )
    )
    assert result.status == "multiple"
    assert result.enumeration_complete
    assert {frozenset(keys(model.literals)) for model in result.models} == {
        frozenset({"delivery", "received"}),
        frozenset({"nonreceipt", "-received"}),
    }
    assert result.skeptical == []


@pytest.mark.parametrize("mutual", [False, True])
def test_strict_exception_cycles_are_formalization_errors_even_for_defeated_candidates(mutual):
    rules = [
        rule("default", "p"),
        rule(
            "conditional", "q", kind="strict", body=[lit("p")], unless=[lit("r" if mutual else "q")]
        ),
    ]
    if mutual:
        rules.append(rule("other", "r", kind="strict", body=[lit("p")], unless=[lit("q")]))
    with pytest.raises(UnsupportedTheoryError, match="conditional"):
        solve(KnowledgeBase(facts=[fact("p", True)], rules=rules), max_models=1)


def test_hypothetical_exception_accounts_for_other_strict_consequences():
    result = solve(
        KnowledgeBase(
            facts=[fact("r", True)],
            rules=[
                rule("default", "p"),
                rule("first", "q", kind="strict", body=[lit("p")]),
                rule("second", "r", kind="strict", body=[lit("p")], unless=[lit("q")]),
            ],
        )
    )
    assert result.status == "unique"
    assert keys(result.skeptical) == {"-r", "p", "q"}


@pytest.mark.parametrize("winner", ["seller", "hold"])
def test_transitive_priority_follows_multiple_strict_steps(winner):
    loser = "hold" if winner == "seller" else "seller"
    result = solve(
        KnowledgeBase(
            rules=[
                rule("seller", "delivery"),
                rule("first", "received", kind="strict", body=[lit("delivery")]),
                rule("second", "eligible", kind="strict", body=[lit("received")]),
                rule("hold", "eligible", negated=True),
                rule("middle", "unrelated"),
            ],
            priorities=[priority(winner, "middle"), priority("middle", loser)],
        )
    )
    assert result.status == "unique"
    assert keys(result.skeptical) == (
        {"delivery", "received", "eligible", "unrelated"}
        if winner == "seller"
        else {"-eligible", "unrelated"}
    )
    assert result.models[0].defeated_rules == [loser]


def test_fact_rooted_strict_chain_cannot_be_overridden_by_priority():
    result = solve(
        KnowledgeBase(
            facts=[fact("delivery")],
            rules=[
                rule("first", "received", kind="strict", body=[lit("delivery")]),
                rule("second", "eligible", kind="strict", body=[lit("received")]),
                rule("hold", "eligible", negated=True),
            ],
            priorities=[priority("hold", "first"), priority("hold", "second")],
        )
    )
    assert result.status == "unique"
    assert keys(result.skeptical) == {"delivery", "received", "eligible"}
    assert result.models[0].defeated_rules == ["hold"]


def test_defeater_blocks_strict_continuation_without_deriving_head():
    result = solve(
        KnowledgeBase(
            rules=[
                rule("seller", "delivery"),
                rule("contest", "eligible", kind="strict", body=[lit("delivery")]),
                rule("hold", "eligible", negated=True, kind="defeater"),
            ]
        )
    )
    assert result.status == "unique"
    assert result.models[0].literals == []
    assert result.models[0].applied_rules == ["hold"]
    assert result.models[0].defeated_rules == ["seller"]


def test_conjunctive_strict_consequence_requires_all_premises():
    rules = [
        rule("seller", "delivery"),
        rule("contest", "eligible", kind="strict", body=[lit("delivery"), lit("verified")]),
        rule("hold", "eligible", negated=True),
    ]
    absent = solve(KnowledgeBase(rules=rules))
    present = solve(KnowledgeBase(facts=[fact("verified")], rules=rules))
    assert absent.status == "unique"
    assert keys(absent.skeptical) == {"delivery", "-eligible"}
    assert present.status == "multiple"
    assert {frozenset(keys(m.literals)) for m in present.models} == {
        frozenset({"verified", "delivery", "eligible"}),
        frozenset({"verified", "-eligible"}),
    }


def test_joint_strict_support_uses_pairwise_root_priorities():
    result = solve(
        KnowledgeBase(
            rules=[
                rule("a", "a"),
                rule("b", "b"),
                rule("d", "c", negated=True),
                rule("joint", "c", kind="strict", body=[lit("a"), lit("b")]),
            ],
            priorities=[priority("b", "d"), priority("d", "a")],
        )
    )
    assert result.status == "multiple"
    assert {frozenset(keys(m.literals)) for m in result.models} == {
        frozenset({"a", "b", "c"}),
        frozenset({"b", "-c"}),
    }


def test_alternative_strict_derivations_cannot_hide_a_conflict():
    result = solve(
        KnowledgeBase(
            facts=[fact("received", True)],
            rules=[
                rule("seller", "delivery"),
                rule("carrier", "signed"),
                rule("first", "received", kind="strict", body=[lit("delivery")]),
                rule("second", "received", kind="strict", body=[lit("signed")]),
            ],
        )
    )
    assert result.status == "unique"
    assert keys(result.skeptical) == {"-received"}
    assert result.models[0].defeated_rules == ["carrier", "seller"]


def test_positive_strict_cycle_does_not_invent_support():
    result = solve(
        KnowledgeBase(
            rules=[
                rule("first", "a", kind="strict", body=[lit("b")]),
                rule("second", "b", kind="strict", body=[lit("a")]),
            ]
        )
    )
    assert result.status == "unique"
    assert result.models[0].literals == []


def test_negative_strict_cycle_through_positive_premises_is_rejected():
    with pytest.raises(UnsupportedTheoryError, match="exception"):
        compile_program(
            KnowledgeBase(
                rules=[
                    rule("positive", "a", kind="strict", body=[lit("b")]),
                    rule("exception", "b", kind="strict", unless=[lit("a")]),
                ]
            )
        )


def test_indirect_defeat_proof_names_opponent_and_conflicting_consequence():
    result = solve(
        KnowledgeBase(
            rules=[
                rule("seller", "delivery"),
                rule("contest", "eligible", kind="strict", body=[lit("delivery")]),
                rule("hold", "eligible", negated=True),
            ],
            priorities=[priority("hold", "seller")],
        )
    )
    model = result.models[0]
    defeat = f"defeat:{model.id}:seller"
    edges = {(e.source, e.target, e.relation) for e in result.proof.edges}
    assert (f"application:{model.id}:hold", defeat, "opposing_rule") in edges
    assert ("literal:eligible", defeat, "conflicting_consequence") in edges
    assert not any(
        e.target == defeat and e.relation == "strict_conflict" for e in result.proof.edges
    )
    identifiers = {n.id for n in result.proof.nodes}
    assert all(e.source in identifiers and e.target in identifiers for e in result.proof.edges)
    assert next(n for n in result.proof.nodes if n.id == "reasoning").data["semantics_version"] == 2
