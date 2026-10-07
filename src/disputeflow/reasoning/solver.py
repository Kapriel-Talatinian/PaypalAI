"""Ground propositional defeasible rules into an auditable clingo program.

Facts and strict consequences cannot be defeated. Opposing defeasible rules of
equal priority produce alternative consistent stable models. A defeater blocks
an opposing conclusion without deriving its own head and only yields to strict
support or a superior opposing rule. Priorities are transitively closed.

The API never accepts raw ASP: domain objects are revalidated and encoded as
integers. Confidence affects downstream governance, never logical entailment.
"""

from __future__ import annotations

import hashlib
import json
import math
import multiprocessing
import time
from dataclasses import dataclass
from typing import Any

from disputeflow.domain import (
    Action,
    KnowledgeBase,
    Literal,
    ProofEdge,
    ProofGraph,
    ProofNode,
    Rule,
    SolverResult,
    StableModel,
)

from .worker import enumerate_program


class SolverError(RuntimeError):
    """Infrastructure error, distinct from a logically inconsistent theory."""


@dataclass(frozen=True)
class _Encoding:
    kb: KnowledgeBase
    literals: tuple[Literal, ...]
    rules: tuple[Rule, ...]
    literal_ids: dict[str, int]
    rule_ids: dict[str, int]


def _prepare(kb: KnowledgeBase) -> _Encoding:
    # Revalidation also rejects bypassed validation via model_construct or
    # in-place mutation of the caller's lists and nested models.
    validated = KnowledgeBase.model_validate(kb.model_dump(mode="json"))

    def citation_key(citation: Any) -> tuple[str, str]:
        return citation.clause_id, citation.quote

    validated.facts = sorted(
        (
            fact.model_copy(update={"evidence_ids": sorted(fact.evidence_ids)})
            for fact in validated.facts
        ),
        key=lambda fact: fact.id,
    )
    validated.rules = sorted(
        (
            rule.model_copy(
                update={
                    "body": sorted(rule.body, key=lambda literal: literal.key()),
                    "unless": sorted(rule.unless, key=lambda literal: literal.key()),
                    "citations": sorted(rule.citations, key=citation_key),
                }
            )
            for rule in validated.rules
        ),
        key=lambda rule: rule.id,
    )
    validated.priorities = sorted(
        (
            priority.model_copy(update={"citations": sorted(priority.citations, key=citation_key)})
            for priority in validated.priorities
        ),
        key=lambda priority: (
            priority.higher,
            priority.lower,
            tuple(citation_key(citation) for citation in priority.citations),
        ),
    )
    names: set[str] = {fact.literal.name for fact in validated.facts}
    for rule in validated.rules:
        names.add(rule.head.name)
        names.update(literal.name for literal in rule.body + rule.unless)
    literals = tuple(
        Literal(name=name, negated=negated) for name in sorted(names) for negated in (False, True)
    )
    rules = tuple(sorted(validated.rules, key=lambda rule: rule.id))
    return _Encoding(
        kb=validated,
        literals=literals,
        rules=rules,
        literal_ids={literal.key(): index for index, literal in enumerate(literals)},
        rule_ids={rule.id: index for index, rule in enumerate(rules)},
    )


def _compile(encoding: _Encoding) -> str:
    lines = [
        "% DisputeFlow propositional defeasible semantics v1",
        "% IDs and literals below have been validated and encoded as integers.",
    ]
    for index, literal in enumerate(encoding.literals):
        lines.append(f"% literal {index}: {literal.key()}")
        lines.append(f"opposite({index},{index ^ 1}).")
    for index, fact in enumerate(sorted(encoding.kb.facts, key=lambda fact: fact.id)):
        lines.append(f"fact({index},{encoding.literal_ids[fact.literal.key()]}).")
    for index, rule in enumerate(encoding.rules):
        lines.append(f"% rule {index}: {rule.id}")
        lines.append(f"kind({index},{rule.kind}).")
        lines.append(f"head({index},{encoding.literal_ids[rule.head.key()]}).")
        conditions = [
            f"holds({encoding.literal_ids[literal.key()]})"
            for literal in sorted(
                {literal.key(): literal for literal in rule.body}.values(),
                key=lambda item: item.key(),
            )
        ]
        conditions.extend(
            f"not holds({encoding.literal_ids[literal.key()]})"
            for literal in sorted(
                {literal.key(): literal for literal in rule.unless}.values(),
                key=lambda item: item.key(),
            )
        )
        suffix = " :- " + ", ".join(conditions) if conditions else ""
        lines.append(f"applicable({index}){suffix}.")
    for higher, lower in sorted(
        {
            (encoding.rule_ids[priority.higher], encoding.rule_ids[priority.lower])
            for priority in encoding.kb.priorities
        }
    ):
        lines.append(f"higher({higher},{lower}).")
    lines.extend(
        [
            "#defined fact/2.",
            "#defined kind/2.",
            "#defined head/2.",
            "#defined higher/2.",
            "#defined opposite/2.",
            "#defined applicable/1.",
            "superior(R,S) :- higher(R,S).",
            "superior(R,T) :- superior(R,S), higher(S,T).",
            "conflict(R,S) :- head(R,L), head(S,C), opposite(L,C), R != S.",
            "holds(L) :- fact(_,L).",
            "strict_support(L) :- fact(_,L).",
            "strict_support(L) :- kind(R,strict), applicable(R), head(R,L).",
            "applied(R) :- kind(R,strict), applicable(R).",
            "applied(R) :- kind(R,defeasible), applicable(R), not defeated(R).",
            "applied(R) :- kind(R,defeater), applicable(R), not defeated(R).",
            "holds(L) :- applied(R), head(R,L), kind(R,K), K != defeater.",
            "defeated(R) :- kind(R,K), K != strict, applicable(R), head(R,L), opposite(L,C), strict_support(C).",
            "defeated(R) :- kind(R,defeasible), applicable(R), applied(S), conflict(R,S), not superior(R,S).",
            "defeated(R) :- kind(R,defeater), applicable(R), applied(S), conflict(R,S), superior(S,R).",
            ":- holds(L), holds(C), opposite(L,C).",
            "#show holds/1.",
            "#show applied/1.",
            "#show defeated/1.",
            "#show applicable/1.",
        ]
    )
    return "\n".join(lines) + "\n"


def compile_program(kb: KnowledgeBase) -> str:
    """Compile validated knowledge without accepting user-supplied ASP text."""
    return _compile(_prepare(kb))


def _enumerate(program: str, max_models: int, deadline: float) -> dict[str, Any] | None:
    remaining = deadline - time.monotonic()
    if remaining <= 0:
        return None
    context = multiprocessing.get_context("spawn")
    receiver, sender = context.Pipe(duplex=False)
    process = context.Process(target=enumerate_program, args=(sender, program, max_models))
    try:
        process.start()
        sender.close()
        models = []
        while True:
            remaining = deadline - time.monotonic()
            if remaining <= 0 or not receiver.poll(remaining):
                return None
            try:
                payload = receiver.recv()
            except EOFError as exc:
                raise SolverError("The isolated ASP worker exited without a result") from exc
            if "error" in payload:
                raise SolverError(f"The isolated ASP worker failed: {payload['error']}")
            if "model" in payload:
                models.append(payload["model"])
            else:
                return {"models": models, "complete": payload["complete"]}
    finally:
        sender.close()
        receiver.close()
        if process.pid is not None:
            process.join(timeout=0.1)
            if process.is_alive():
                process.terminate()
                process.join(timeout=0.1)
            if process.is_alive():
                process.kill()
                process.join(timeout=0.1)
            process.close()


def _model(encoding: _Encoding, raw: dict[str, list[int]]) -> StableModel:
    literals = sorted(
        (encoding.literals[index] for index in raw["holds"]), key=lambda literal: literal.key()
    )
    applied = sorted(encoding.rules[index].id for index in raw["applied"])
    defeated = sorted(encoding.rules[index].id for index in raw["defeated"])
    identity = json.dumps(
        {
            "literals": [literal.key() for literal in literals],
            "applied": applied,
            "defeated": defeated,
        },
        sort_keys=True,
        separators=(",", ":"),
    )
    present = {literal.name for literal in literals if not literal.negated}
    decisions = sorted(
        (action for action in Action if f"decision_{action.value}" in present),
        key=lambda action: action.value,
    )
    return StableModel(
        id="m_" + hashlib.sha256(identity.encode()).hexdigest()[:24],
        literals=literals,
        applied_rules=applied,
        defeated_rules=defeated,
        decisions=decisions,
    )


def _priority_closure(kb: KnowledgeBase) -> set[tuple[str, str]]:
    graph: dict[str, set[str]] = {rule.id: set() for rule in kb.rules}
    for priority in kb.priorities:
        graph[priority.higher].add(priority.lower)
    closure: set[tuple[str, str]] = set()
    for higher in graph:
        pending = list(graph[higher])
        reached: set[str] = set()
        while pending:
            lower = pending.pop()
            if lower not in reached:
                reached.add(lower)
                pending.extend(graph[lower])
        closure.update((higher, lower) for lower in reached)
    return closure


def _proof(encoding: _Encoding, models: list[StableModel], status: str, digest: str) -> ProofGraph:
    nodes: dict[str, ProofNode] = {}
    edges: set[tuple[str, str, str]] = set()

    def node(identifier: str, kind: str, label: str, /, **data: Any) -> str:
        nodes[identifier] = ProofNode(id=identifier, kind=kind, label=label, data=data)
        return identifier

    def edge(source: str, target: str, relation: str) -> None:
        edges.add((source, target, relation))

    def literal_id(literal: Literal) -> str:
        return f"literal:{literal.key()}"

    def cite(citation: Any, target: str) -> None:
        data = citation.model_dump(mode="json")
        identity = hashlib.sha256(json.dumps(data, sort_keys=True).encode()).hexdigest()
        source = node(f"citation:{identity}", "citation", citation.clause_id, **data)
        edge(source, target, "grounds")

    root = node(
        "reasoning",
        "reasoning",
        status,
        program_sha256=digest,
        status=status,
        semantics_version=1,
        enumeration_complete=status in {"unique", "multiple", "inconsistent"},
    )
    for literal in encoding.literals:
        node(literal_id(literal), "literal", literal.key(), **literal.model_dump(mode="json"))
    for fact in encoding.kb.facts:
        fid = node(f"fact:{fact.id}", "fact", fact.id, **fact.model_dump(mode="json"))
        edge(fid, literal_id(fact.literal), "asserts")
        for evidence in fact.evidence_ids:
            eid = node(f"evidence:{evidence}", "evidence", evidence, evidence_id=evidence)
            edge(eid, fid, "supports")
    for rule in encoding.rules:
        rid = node(f"rule:{rule.id}", "rule", rule.id, **rule.model_dump(mode="json"))
        edge(rid, literal_id(rule.head), "head")
        for literal in rule.body:
            edge(literal_id(literal), rid, "premise")
        for literal in rule.unless:
            edge(literal_id(literal), rid, "exception")
        for citation in rule.citations:
            cite(citation, rid)
    for index, priority in enumerate(encoding.kb.priorities):
        pid = node(
            f"priority:{index}",
            "priority",
            f"{priority.higher} > {priority.lower}",
            **priority.model_dump(mode="json"),
        )
        edge(f"rule:{priority.higher}", f"rule:{priority.lower}", "overrides")
        edge(pid, f"rule:{priority.higher}", "higher")
        edge(pid, f"rule:{priority.lower}", "lower")
        for citation in priority.citations:
            cite(citation, pid)

    closure = _priority_closure(encoding.kb)
    rules = {rule.id: rule for rule in encoding.rules}
    for model in models:
        mid = node(f"model:{model.id}", "stable_model", model.id, **model.model_dump(mode="json"))
        edge(root, mid, "extension")
        for literal in model.literals:
            edge(mid, literal_id(literal), "contains")
        for rule_id in model.applied_rules:
            rule = rules[rule_id]
            aid = node(
                f"application:{model.id}:{rule_id}",
                "application",
                rule_id,
                model_id=model.id,
                rule_id=rule_id,
                derives_head=rule.kind != "defeater",
                absent_exceptions=[literal.key() for literal in rule.unless],
            )
            edge(mid, aid, "includes")
            edge(f"rule:{rule_id}", aid, "instantiates")
            for literal in rule.body:
                edge(literal_id(literal), aid, "supports")
            if rule.kind == "defeater":
                opposite = Literal(name=rule.head.name, negated=not rule.head.negated)
                edge(aid, literal_id(opposite), "blocks")
            else:
                edge(aid, literal_id(rule.head), "derives")
        for rule_id in model.defeated_rules:
            rule = rules[rule_id]
            did = node(
                f"defeat:{model.id}:{rule_id}",
                "defeat",
                rule_id,
                model_id=model.id,
                rule_id=rule_id,
            )
            edge(mid, did, "includes")
            edge(did, f"rule:{rule_id}", "defeats")
            contrary = Literal(name=rule.head.name, negated=not rule.head.negated).key()
            for fact in encoding.kb.facts:
                if fact.literal.key() == contrary:
                    edge(f"fact:{fact.id}", did, "strict_conflict")
            for opponent_id in model.applied_rules:
                opponent = rules[opponent_id]
                if opponent.head.key() != contrary:
                    continue
                strict = opponent.kind == "strict"
                blocks = (
                    (opponent_id, rule_id) in closure
                    if rule.kind == "defeater"
                    else (rule_id, opponent_id) not in closure
                )
                if strict or blocks:
                    edge(
                        f"application:{model.id}:{opponent_id}",
                        did,
                        "strict_conflict" if strict else "opposing_rule",
                    )
    for fact in encoding.kb.facts:
        contrary = Literal(name=fact.literal.name, negated=not fact.literal.negated).key()
        for other in encoding.kb.facts:
            if other.literal.key() == contrary:
                edge(f"fact:{fact.id}", f"fact:{other.id}", "contradicts")
    return ProofGraph(
        nodes=[nodes[identifier] for identifier in sorted(nodes)],
        edges=[
            ProofEdge(source=source, target=target, relation=relation)
            for source, target, relation in sorted(edges)
        ],
    )


def solve(kb: KnowledgeBase, *, max_models: int = 64, timeout_seconds: float = 5) -> SolverResult:
    """Enumerate stable models within a hard deadline, then derive safe summaries.

    A truncated or timed out enumeration never claims skeptical entailment or a
    unique decision. Model IDs and ordering are stable across input reordering.
    """
    if (
        isinstance(max_models, bool)
        or not isinstance(max_models, int)
        or not 1 <= max_models <= 4096
    ):
        raise ValueError("max_models must be an integer between 1 and 4096")
    if (
        isinstance(timeout_seconds, bool)
        or not isinstance(timeout_seconds, (int, float))
        or not math.isfinite(timeout_seconds)
        or not 0 < timeout_seconds <= 300
    ):
        raise ValueError("timeout_seconds must be finite and between 0 and 300")
    deadline = time.monotonic() + timeout_seconds
    encoding = _prepare(kb)
    program = _compile(encoding)
    digest = hashlib.sha256(program.encode()).hexdigest()
    payload = _enumerate(program, max_models, deadline)
    diagnostics: list[str] = []
    models: list[StableModel] = []
    complete = False
    if payload is None:
        status = "timeout"
        diagnostics.append(
            "ASP grounding or solving exceeded the wall-clock deadline; no decision is established."
        )
    else:
        raw_models = payload["models"]
        complete = bool(payload["complete"]) and len(raw_models) <= max_models
        models = sorted(
            (_model(encoding, raw) for raw in raw_models[:max_models]), key=lambda model: model.id
        )
        if not complete:
            status = "truncated"
            diagnostics.append(
                f"More than {max_models} stable models exist; enumeration is incomplete."
            )
        elif not models:
            status = "inconsistent"
            diagnostics.append(
                "The theory has no consistent stable model; review evidence and extracted rules."
            )
        else:
            status = "unique" if len(models) == 1 else "multiple"
    keys = [{literal.key() for literal in model.literals} for model in models]
    credulous_keys = set.union(*keys) if keys else set()
    skeptical_keys = set.intersection(*keys) if complete and keys else set()
    by_key = {literal.key(): literal for literal in encoding.literals}
    return SolverResult(
        status=status,
        models=models,
        enumeration_complete=complete,
        program=program,
        program_sha256=digest,
        skeptical=[by_key[key] for key in sorted(skeptical_keys)],
        credulous=[by_key[key] for key in sorted(credulous_keys)],
        proof=_proof(encoding, models, status, digest),
        diagnostics=diagnostics,
    )
