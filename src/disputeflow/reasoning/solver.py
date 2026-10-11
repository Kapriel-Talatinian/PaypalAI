"""Ground propositional defeasible rules into an auditable clingo program.

Facts and their exclusively strict consequences cannot be defeated. Strict
continuations of defeasible premises retain their defeasible roots. Opposing
defeasible arguments of equal priority produce alternative consistent models. A defeater blocks
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


class UnsupportedTheoryError(ValueError):
    """Unsupported rule formalization, not contradictory business evidence."""


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


def _validate_strict_exceptions(encoding: _Encoding) -> None:
    """Reject negative strict dependency cycles before hypothetical expansion.

    A stratified strict fragment gives every candidate a deterministic closure.
    Positive recursion is permitted. Defeasible exceptions keep their existing
    stable-model semantics; they are not part of this dependency graph.
    """
    strict = [rule for rule in encoding.rules if rule.kind == "strict"]
    dependencies: dict[str, set[str]] = {}
    for rule in strict:
        dependencies.setdefault(rule.head.key(), set()).update(
            literal.key() for literal in rule.body + rule.unless
        )
    reachability: dict[str, set[str]] = {}
    for start in {literal.key() for rule in strict for literal in rule.unless}:
        reached: set[str] = set()
        pending = [start]
        while pending:
            current = pending.pop()
            if current not in reached:
                reached.add(current)
                pending.extend(dependencies.get(current, set()) - reached)
        reachability[start] = reached
    cyclic = [
        rule.id
        for rule in strict
        if any(rule.head.key() in reachability[literal.key()] for literal in rule.unless)
    ]
    if cyclic:
        raise UnsupportedTheoryError(
            "Strict-rule exceptions must be stratified; negative dependency cycle "
            "through exception rules: " + ", ".join(cyclic)
        )


def _candidate_closure(encoding: _Encoding) -> list[str]:
    """Strict closure of the current extension plus each candidate head."""
    lines = [
        "candidate(R,L) :- kind(R,defeasible), applicable(R), holds(L).",
        "candidate(R,L) :- kind(R,defeasible), applicable(R), head(R,L).",
    ]
    for index, rule in enumerate(encoding.rules):
        if rule.kind != "strict":
            continue
        conditions = ["kind(R,defeasible)", "applicable(R)"]
        conditions += [
            f"candidate(R,{encoding.literal_ids[literal.key()]})" for literal in rule.body
        ]
        conditions += [
            f"not candidate(R,{encoding.literal_ids[literal.key()]})" for literal in rule.unless
        ]
        lines.append(f"candidate_applicable(R,{index}) :- " + ", ".join(conditions) + ".")
        lines.append(
            f"candidate(R,{encoding.literal_ids[rule.head.key()]}) :- candidate_applicable(R,{index})."
        )
    return lines


def _compile(encoding: _Encoding) -> str:
    _validate_strict_exceptions(encoding)
    lines = [
        "% DisputeFlow propositional defeasible semantics v2",
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
        if rule.kind == "strict":
            # Definite support must be rooted exclusively in facts/strict support.
            definite = [
                f"strict_support({encoding.literal_ids[literal.key()]})" for literal in rule.body
            ]
            definite.extend(
                f"not holds({encoding.literal_ids[literal.key()]})" for literal in rule.unless
            )
            tail = " :- " + ", ".join(definite) if definite else ""
            lines.append(f"strict_support({encoding.literal_ids[rule.head.key()]}){tail}.")
            if rule.body:
                head = encoding.literal_ids[rule.head.key()]
                for premise in sorted(
                    {encoding.literal_ids[literal.key()] for literal in rule.body}
                ):
                    lines.append(
                        f"argument(R,{head}) :- candidate_applicable(R,{index}), argument(R,{premise})."
                    )
                    lines.append(
                        f"support(R,{head}) :- kind(R,defeasible), applied({index}), support(R,{premise})."
                    )
    lines.extend(_candidate_closure(encoding))
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
            "holds(L) :- fact(_,L).",
            "strict_support(L) :- fact(_,L).",
            "applied(R) :- kind(R,strict), applicable(R).",
            "applied(R) :- kind(R,defeasible), applicable(R), not defeated(R).",
            "applied(R) :- kind(R,defeater), applicable(R), not defeated(R).",
            "holds(L) :- applied(R), head(R,L), kind(R,K), K != defeater.",
            "argument(R,L) :- kind(R,K), K != strict, applicable(R), head(R,L).",
            "support(R,L) :- kind(R,K), K != strict, applied(R), head(R,L).",
            "strict_attack(R,L) :- argument(R,L), opposite(L,C), strict_support(C).",
            "defeated(R) :- strict_attack(R,_).",
            "attack(R,S,L) :- kind(R,defeasible), argument(R,L), support(S,C), opposite(L,C), R != S, not superior(R,S).",
            "attack(R,S,L) :- kind(R,defeater), argument(R,L), support(S,C), opposite(L,C), superior(S,R).",
            "defeated(R) :- attack(R,_,_).",
            "self_attack(R,L) :- kind(R,defeasible), argument(R,L), argument(R,C), opposite(L,C).",
            "defeated(R) :- self_attack(R,_).",
            ":- holds(L), holds(C), opposite(L,C).",
            "#show holds/1.",
            "#show applied/1.",
            "#show defeated/1.",
            "#show applicable/1.",
            "#show attack/3.",
            "#show strict_attack/2.",
            "#show self_attack/2.",
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


def _model(encoding: _Encoding, raw: dict[str, Any]) -> StableModel:
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


def _proof(
    encoding: _Encoding,
    models: list[StableModel],
    status: str,
    digest: str,
    witnesses: dict[str, dict[str, Any]],
) -> ProofGraph:
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
        semantics_version=2,
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
            # Use the solver's actual defeat witnesses, including indirect conflicts.
            raw = witnesses[model.id]
            rule_index = encoding.rule_ids[rule_id]
            for target, opponent, literal in raw.get("attack", []):
                if target == rule_index:
                    edge(
                        f"application:{model.id}:{encoding.rules[opponent].id}",
                        did,
                        "opposing_rule",
                    )
                    edge(literal_id(encoding.literals[literal]), did, "conflicting_consequence")
            for target, literal in raw.get("strict_attack", []):
                if target == rule_index:
                    edge(literal_id(encoding.literals[literal ^ 1]), did, "strict_conflict")
            for target, literal in raw.get("self_attack", []):
                if target == rule_index:
                    edge(literal_id(encoding.literals[literal]), did, "self_conflict")
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
    witnesses: dict[str, dict[str, Any]] = {}
    complete = False
    if payload is None:
        status = "timeout"
        diagnostics.append(
            "ASP grounding or solving exceeded the wall-clock deadline; no decision is established."
        )
    else:
        raw_models = payload["models"]
        complete = bool(payload["complete"]) and len(raw_models) <= max_models
        for raw in raw_models[:max_models]:
            model = _model(encoding, raw)
            models.append(model)
            witnesses[model.id] = raw
        models.sort(key=lambda model: model.id)
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
        proof=_proof(encoding, models, status, digest, witnesses),
        diagnostics=diagnostics,
    )
