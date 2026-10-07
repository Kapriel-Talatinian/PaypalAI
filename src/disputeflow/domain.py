"""Validated contracts exchanged by agents; no LLM output is executable code."""

from datetime import datetime
from decimal import Decimal
from enum import StrEnum
from typing import Annotated, Any
from typing import Literal as TypeLiteral

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

Identifier = Annotated[str, Field(pattern=r"^[a-z][a-z0-9_]{0,63}$")]
ResourceId = Annotated[str, Field(pattern=r"^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$")]


class Contract(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Action(StrEnum):
    ACCEPT_CLAIM = "accept_claim"
    PROVIDE_EVIDENCE = "provide_evidence"
    MAKE_OFFER = "make_offer"
    ESCALATE = "escalate"
    SEND_MESSAGE = "send_message"
    NO_ACTION = "no_action"


class Literal(Contract):
    name: Identifier
    negated: bool = False

    def key(self) -> str:
        return ("-" if self.negated else "") + self.name


class Evidence(Contract):
    id: ResourceId
    kind: str = Field(default="statement", min_length=1, max_length=64)
    content: str = Field(min_length=1, max_length=40_000)
    verified: bool = False
    source: str = Field(default="operator", max_length=500)


class CaseInput(Contract):
    external_id: ResourceId | None = None
    reason: str = Field(min_length=1, max_length=128)
    amount: Decimal = Field(ge=0, max_digits=16, decimal_places=2)
    currency: str = Field(default="USD", pattern=r"^[A-Z]{3}$")
    summary: str = Field(min_length=1, max_length=20_000)
    evidence: list[Evidence] = Field(default_factory=list, max_length=100)
    policy_id: ResourceId = "demo_policy"
    auto_execute: bool = False
    allowed_actions: list[Action] = Field(default_factory=list)

    @model_validator(mode="after")
    def unique_evidence(self) -> "CaseInput":
        if len({e.id for e in self.evidence}) != len(self.evidence):
            raise ValueError("Evidence IDs must be unique")
        return self


class Fact(Contract):
    id: Identifier
    literal: Literal
    evidence_ids: list[ResourceId] = Field(min_length=1, max_length=100)
    confidence: float = Field(default=1, ge=0, le=1)


class ClauseCitation(Contract):
    clause_id: ResourceId
    quote: str = Field(min_length=1, max_length=40_000)


class Rule(Contract):
    id: Identifier
    head: Literal
    body: list[Literal] = Field(default_factory=list, max_length=100)
    unless: list[Literal] = Field(default_factory=list, max_length=100)
    kind: TypeLiteral["strict", "defeasible", "defeater"] = "defeasible"
    citations: list[ClauseCitation] = Field(min_length=1, max_length=100)


class Priority(Contract):
    higher: Identifier
    lower: Identifier
    citations: list[ClauseCitation] = Field(min_length=1, max_length=100)


class KnowledgeBase(Contract):
    facts: list[Fact] = Field(default_factory=list, max_length=500)
    rules: list[Rule] = Field(default_factory=list, max_length=500)
    priorities: list[Priority] = Field(default_factory=list, max_length=1000)
    confidence: float = Field(default=1, ge=0, le=1)
    warnings: list[str] = Field(default_factory=list, max_length=100)

    @model_validator(mode="after")
    def validate_references(self) -> "KnowledgeBase":
        for items in (self.facts, self.rules):
            if len({item.id for item in items}) != len(items):
                raise ValueError("Fact and rule identifiers must be unique within their type")
        ids = {r.id for r in self.rules}
        graph: dict[str, set[str]] = {rid: set() for rid in ids}
        for priority in self.priorities:
            if priority.higher not in ids or priority.lower not in ids:
                raise ValueError("Priority refers to an unknown rule")
            graph[priority.higher].add(priority.lower)
        visiting: set[str] = set()
        visited: set[str] = set()

        def walk(node: str) -> None:
            if node in visiting:
                raise ValueError("Rule priorities must be acyclic")
            if node in visited:
                return
            visiting.add(node)
            for child in graph[node]:
                walk(child)
            visiting.remove(node)
            visited.add(node)

        for node in graph:
            walk(node)
        return self


class PolicySection(Contract):
    id: ResourceId
    title: str = Field(min_length=1, max_length=300)
    text: str = Field(default="", max_length=80_000)
    children: list["PolicySection"] = Field(default_factory=list, max_length=100)
    keywords: list[str] = Field(default_factory=list, max_length=100)


class PolicyDocument(Contract):
    id: ResourceId
    title: str = Field(min_length=1, max_length=300)
    version: str = Field(min_length=1, max_length=100)
    source_url: str = Field(min_length=1, max_length=2000)
    synthetic: bool = True
    sections: list[PolicySection] = Field(min_length=1, max_length=100)

    @model_validator(mode="after")
    def unique_sections(self) -> "PolicyDocument":
        seen: set[str] = set()
        count = 0

        def walk(section: PolicySection, depth: int) -> None:
            nonlocal count
            count += 1
            if depth > 10 or count > 1000:
                raise ValueError("Policy tree exceeds depth or size limits")
            if section.id in seen:
                raise ValueError("Section identifiers must be unique")
            seen.add(section.id)
            for child in section.children:
                walk(child, depth + 1)

        for section in self.sections:
            walk(section, 1)
        return self


class Clause(Contract):
    id: ResourceId
    section_path: list[str]
    title: str
    text: str
    source_url: str
    version: str
    sha256: str


class RetrievalResult(Contract):
    policy_id: str
    policy_version: str
    synthetic: bool
    clauses: list[Clause]
    trace: list[dict[str, Any]] = Field(default_factory=list)


class ProofNode(Contract):
    id: str
    kind: str
    label: str
    data: dict[str, Any] = Field(default_factory=dict)


class ProofEdge(Contract):
    source: str
    target: str
    relation: str


class ProofGraph(Contract):
    nodes: list[ProofNode] = Field(default_factory=list)
    edges: list[ProofEdge] = Field(default_factory=list)


class StableModel(Contract):
    id: str
    literals: list[Literal]
    applied_rules: list[str]
    defeated_rules: list[str]
    decisions: list[Action]


class SolverResult(Contract):
    status: TypeLiteral["unique", "multiple", "inconsistent", "truncated", "timeout"]
    models: list[StableModel]
    enumeration_complete: bool
    program: str
    program_sha256: str
    skeptical: list[Literal]
    credulous: list[Literal]
    proof: ProofGraph
    diagnostics: list[str] = Field(default_factory=list)


class GovernanceResult(Contract):
    recommended_action: Action | None
    confidence: float = Field(ge=0, le=1)
    requires_human: bool
    reasons: list[str]
    components: dict[str, float]


class ReviewInput(Contract):
    action: Action
    note: str = Field(min_length=3, max_length=4000)


class ExecutionInput(Contract):
    payload: dict[str, Any] = Field(default_factory=dict)


class ImportPayPalInput(Contract):
    policy_id: ResourceId = "demo_policy"
    auto_execute: bool = False


class ReconcileInput(Contract):
    outcome: TypeLiteral["succeeded", "failed"]
    note: str = Field(min_length=10, max_length=4000)


class RunRequest(Contract):
    execute: bool = False


class EvidenceUpdate(Contract):
    evidence: list[Evidence] = Field(min_length=1, max_length=100)

    @field_validator("evidence")
    @classmethod
    def distinct(cls, evidence: list[Evidence]) -> list[Evidence]:
        if len({item.id for item in evidence}) != len(evidence):
            raise ValueError("Evidence IDs must be unique")
        return evidence


class EvidenceVerificationInput(Contract):
    verified: bool = True
    note: str = Field(min_length=3, max_length=4000)


class AnalysisResult(Contract):
    retrieval: RetrievalResult
    knowledge_base: KnowledgeBase | None
    solver: SolverResult | None
    governance: GovernanceResult
    attempts: list[dict[str, Any]]
    agents: list[str]


class RunView(Contract):
    id: str
    case_id: str
    case_version: int
    input_snapshot: CaseInput
    status: str
    execute_requested: bool
    result: AnalysisResult | None
    error: str | None
    created_at: datetime
    finished_at: datetime | None


class CaseView(Contract):
    id: str
    external_id: str | None
    origin: str
    data: CaseInput
    version: int
    status: str
    latest_run_id: str | None
    created_at: datetime
    updated_at: datetime
    latest_run: RunView | None = None


class CasePage(Contract):
    items: list[CaseView]
    total: int
    offset: int = 0
    limit: int = 50


class ExecutionView(Contract):
    id: str
    run_id: str
    idempotency_key: str
    request_hash: str
    mode: TypeLiteral["dry_run", "sandbox", "live"]
    action: Action
    payload: dict[str, Any]
    status: str
    response: dict[str, Any] | None
    error: str | None
    created_at: datetime
    finished_at: datetime | None


class ReviewView(Contract):
    id: str
    run_id: str
    action: Action
    note: str
    actor: str
    created_at: datetime
