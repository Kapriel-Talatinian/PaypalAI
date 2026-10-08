"""Validated contracts exchanged by agents; no LLM output is executable code."""

from datetime import datetime
from decimal import Decimal
from enum import StrEnum
from typing import Annotated, Any
from typing import Literal as TypeLiteral

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, field_validator, model_validator

Identifier = Annotated[str, Field(pattern=r"^[a-z][a-z0-9_]{0,63}$")]
ResourceId = Annotated[str, Field(pattern=r"^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$")]


class Contract(BaseModel):
    model_config = ConfigDict(extra="forbid")


class VersionedContract(Contract):
    """Only this wire version is accepted; missing versions decode legacy records."""

    contract_version: TypeLiteral["1.0"] = "1.0"


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


class PayPalMoney(Contract):
    value: Decimal = Field(max_digits=32, decimal_places=3)
    currency_code: str = Field(pattern=r"^[A-Z]{3}$")


class PayPalParty(Contract):
    name: str | None = None
    email: str | None = None
    merchant_id: str | None = None


class PayPalItem(Contract):
    item_id: str | None = None
    item_name: str | None = None
    item_description: str | None = None
    item_quantity: int | None = Field(default=None, ge=1)
    item_type: str | None = None
    reason: str | None = None
    dispute_amount: PayPalMoney | None = None
    partner_transaction_id: str | None = None
    notes: str | None = None


class PayPalTransaction(Contract):
    seller_transaction_id: str | None = None
    buyer_transaction_id: str | None = None
    reference_id: str | None = None
    create_time: AwareDatetime | None = None
    transaction_status: str | None = None
    gross_amount: PayPalMoney | None = None
    invoice_number: str | None = None
    custom: str | None = None
    buyer: PayPalParty | None = None
    seller: PayPalParty | None = None
    items: list[PayPalItem] = Field(default_factory=list)


class PayPalTracking(Contract):
    carrier_name: str | None = None
    carrier_name_other: str | None = None
    tracking_number: str | None = None
    tracking_url: str | None = None


class PayPalDocument(Contract):
    name: str | None = None
    url: str | None = None


class PayPalEvidenceRequirement(Contract):
    evidence_type: str | None = None
    action: str | None = None
    response_option: str | None = None
    mandatory: bool | None = None


class PayPalEvidence(Contract):
    evidence_type: str | None = None
    source: str | None = None
    date: AwareDatetime | None = None
    notes: str | None = None
    item_id: str | None = None
    item_type: str | None = None
    dispute_life_cycle_stage: str | None = None
    action_info: PayPalEvidenceRequirement | None = None
    tracking_info: list[PayPalTracking] = Field(default_factory=list)
    refund_ids: list[str] = Field(default_factory=list)
    documents: list[PayPalDocument] = Field(default_factory=list)


class PayPalSupportingInfo(Contract):
    notes: str | None = None
    source: str | None = None
    provided_time: AwareDatetime | None = None
    dispute_life_cycle_stage: str | None = None
    documents: list[PayPalDocument] = Field(default_factory=list)


class PayPalReturnAddress(Contract):
    address_line_1: str | None = None
    address_line_2: str | None = None
    address_line_3: str | None = None
    admin_area_1: str | None = None
    admin_area_2: str | None = None
    admin_area_3: str | None = None
    admin_area_4: str | None = None
    postal_code: str | None = None
    country_code: str | None = None


class PayPalDelivery(Contract):
    source_path: str
    item_id: str | None = None
    description: str | None = None
    product_received: str | None = None
    product_received_time: AwareDatetime | None = None
    expected_delivery_date: AwareDatetime | None = None
    return_time: AwareDatetime | None = None
    return_mode: str | None = None
    return_receipt: bool | None = None
    returned: bool | None = None
    return_confirmation_number: str | None = None


class PayPalRefundDetails(Contract):
    allowed_refund_amount: PayPalMoney | None = None
    amount_refunded: PayPalMoney | None = None
    outcome_code: str | None = None


class PayPalMoneyMovement(Contract):
    affected_party: str | None = None
    amount: PayPalMoney | None = None
    initiated_time: AwareDatetime | None = None
    type: str | None = None
    reason: str | None = None


class PayPalResponseOptions(Contract):
    accept_claim_types: list[str] = Field(default_factory=list)
    offer_types: list[str] = Field(default_factory=list)
    acknowledgement_types: list[str] = Field(default_factory=list)


class PayPalLink(Contract):
    href: str
    rel: str
    method: str | None = None


class PayPalDisputeMetadata(Contract):
    """Provider observations, never independently verified assertions of truth.

    Unknown fields remain in the original snapshot; missing optional observations
    stay null/empty. Malformed optional fields are reported without inventing a
    substitute. Executable actions still come from validated PayPal action links.
    """

    dispute_id: str
    reason: str
    status: str | None = None
    dispute_state: str | None = None
    dispute_life_cycle_stage: str | None = None
    dispute_channel: str | None = None
    create_time: AwareDatetime | None = None
    update_time: AwareDatetime | None = None
    seller_response_due_date: AwareDatetime | None = None
    buyer_response_due_date: AwareDatetime | None = None
    transactions: list[PayPalTransaction] = Field(default_factory=list)
    existing_evidence: list[PayPalEvidence] = Field(default_factory=list)
    requested_evidence: list[PayPalEvidenceRequirement] = Field(default_factory=list)
    supporting_info: list[PayPalSupportingInfo] = Field(default_factory=list)
    tracking_info: list[PayPalTracking] = Field(default_factory=list)
    refund_ids: list[str] = Field(default_factory=list)
    delivery_details: list[PayPalDelivery] = Field(default_factory=list)
    return_shipping_address: PayPalReturnAddress | None = None
    refund_details: PayPalRefundDetails | None = None
    money_movements: list[PayPalMoneyMovement] = Field(default_factory=list)
    allowed_response_options: PayPalResponseOptions = Field(default_factory=PayPalResponseOptions)
    links: list[PayPalLink] = Field(default_factory=list)
    normalization_warnings: list[str] = Field(default_factory=list)


class CaseInput(Contract):
    external_id: ResourceId | None = None
    reason: str = Field(min_length=1, max_length=128)
    amount: Decimal = Field(ge=0, max_digits=16, decimal_places=3)
    currency: str = Field(default="USD", pattern=r"^[A-Z]{3}$")
    summary: str = Field(min_length=1, max_length=20_000)
    evidence: list[Evidence] = Field(default_factory=list, max_length=100)
    policy_id: ResourceId = "demo_policy"
    auto_execute: bool = False
    allowed_actions: list[Action] = Field(default_factory=list)
    paypal: PayPalDisputeMetadata | None = None

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
    authoritative_vocabulary: list[Identifier] | None = Field(default=None, max_length=1000)
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


class RetrievalTraceStep(VersionedContract):
    path: list[str]
    offered: list[ResourceId]
    selected: list[ResourceId]
    selector: TypeLiteral["deterministic_demo", "llm"]
    operation: TypeLiteral["selection"] = "selection"
    mode: TypeLiteral["deterministic", "probabilistic"] = "deterministic"
    duration_ms: float = Field(default=0, ge=0)
    input_sha256: str | None = None
    output_sha256: str | None = None

    def __getitem__(self, key: str) -> Any:
        """Compatibility for callers reading the former trace dictionaries."""
        return getattr(self, key)


class RetrievalResult(VersionedContract):
    policy_id: str
    policy_version: str
    synthetic: bool
    authoritative_vocabulary: list[Identifier] | None = Field(default=None, max_length=1000)
    clauses: list[Clause]
    trace: list[RetrievalTraceStep] = Field(default_factory=list)


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


class SolverDiagnostic(Contract):
    code: Identifier
    severity: TypeLiteral["error", "warning", "info"]
    message: str = Field(min_length=1, max_length=8000)
    fact_ids: list[Identifier] = Field(default_factory=list, max_length=500)
    rule_ids: list[Identifier] = Field(default_factory=list, max_length=500)
    literals: list[str] = Field(default_factory=list, max_length=2000)
    suggestions: list[Identifier] = Field(default_factory=list, max_length=3)


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
    diagnostic_details: list[SolverDiagnostic] = Field(default_factory=list)


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


class PolicyHeading(Contract):
    id: ResourceId
    title: str
    keywords: list[str] = Field(default_factory=list)
    has_text: bool
    children: list["PolicyHeading"] = Field(default_factory=list)


class PolicySelectionInput(VersionedContract):
    component: TypeLiteral["policy_selection"] = "policy_selection"
    case: CaseInput
    headings: list[PolicyHeading]
    path: list[str]


class PolicySelectionOutput(VersionedContract):
    component: TypeLiteral["policy_selection"] = "policy_selection"
    section_ids: list[ResourceId]


class PolicyRetrievalInput(VersionedContract):
    component: TypeLiteral["policy_retrieval"] = "policy_retrieval"
    case: CaseInput
    policy: PolicyDocument
    max_clauses: int = Field(default=12, ge=1, le=1000)


class PolicyRetrievalOutput(VersionedContract):
    component: TypeLiteral["policy_retrieval"] = "policy_retrieval"
    retrieval: RetrievalResult


class ExtractionInput(VersionedContract):
    component: TypeLiteral["extraction"] = "extraction"
    case: CaseInput
    retrieval: RetrievalResult
    previous: KnowledgeBase | None = None
    diagnostics: list[str] = Field(default_factory=list)


class ExtractionOutput(VersionedContract):
    component: TypeLiteral["extraction"] = "extraction"
    knowledge_base: KnowledgeBase


class VerificationInput(VersionedContract):
    component: TypeLiteral["verification"] = "verification"
    case: CaseInput
    retrieval: RetrievalResult
    knowledge_base: KnowledgeBase
    previous: KnowledgeBase | None = None


class VerificationResult(VersionedContract):
    valid: TypeLiteral[True]
    checked_fact_ids: list[Identifier]
    checked_clause_sha256: dict[str, str]
    checked_citations: int = Field(ge=0)
    knowledge_base_sha256: str
    scope: TypeLiteral["references_hashes_exact_quotes"] = "references_hashes_exact_quotes"
    semantic_entailment_checked: TypeLiteral[False] = False


class VerificationOutput(VersionedContract):
    component: TypeLiteral["verification"] = "verification"
    verification: VerificationResult


class ReasoningInput(VersionedContract):
    component: TypeLiteral["asp_reasoning"] = "asp_reasoning"
    knowledge_base: KnowledgeBase
    authoritative_vocabulary: list[Identifier] | None = None
    max_models: int = Field(ge=1)
    timeout_seconds: float = Field(gt=0)


class ReasoningOutput(VersionedContract):
    component: TypeLiteral["asp_reasoning"] = "asp_reasoning"
    solver: SolverResult


class GovernanceControls(Contract):
    auto_confidence_threshold: float = Field(ge=0, le=1)
    auto_max_amount: float = Field(ge=0)
    auto_currency: str = Field(pattern=r"^[A-Z]{3}$")


class GovernanceInput(VersionedContract):
    component: TypeLiteral["governance"] = "governance"
    case: CaseInput
    retrieval: RetrievalResult
    knowledge_base: KnowledgeBase
    solver: SolverResult
    controls: GovernanceControls


class GovernanceOutput(VersionedContract):
    component: TypeLiteral["governance"] = "governance"
    governance: GovernanceResult


class AnalysisAttempt(VersionedContract):
    attempt: int = Field(ge=0)
    status: TypeLiteral[
        "invalid_extraction",
        "unique",
        "multiple",
        "inconsistent",
        "truncated",
        "timeout",
        "component_failed",
    ]
    knowledge_base: KnowledgeBase | None = None
    program_sha256: str | None = None
    solver: SolverResult | None = None
    diagnostics: list[str] = Field(default_factory=list)
    decision: TypeLiteral["return", "repair", "reject"] = "return"


class AnalysisStep(VersionedContract):
    component: TypeLiteral[
        "policy_retrieval", "extraction", "verification", "asp_reasoning", "governance"
    ]
    mode: TypeLiteral["deterministic", "probabilistic"]
    attempt: int = Field(default=0, ge=0)
    status: TypeLiteral["succeeded", "rejected", "failed"]
    decision: str
    started_at: datetime
    finished_at: datetime
    duration_ms: float = Field(ge=0)
    input_sha256: str
    output_sha256: str | None = None
    error_code: str | None = None
    diagnostics: list[str] = Field(default_factory=list)
    input_ref: str
    output_ref: str | None = None
    verification: VerificationResult | None = None
    max_clauses: int | None = None
    max_models: int | None = None
    timeout_seconds: float | None = None
    governance_controls: GovernanceControls | None = None

    @model_validator(mode="after")
    def matching_component(self) -> "AnalysisStep":
        if self.finished_at < self.started_at:
            raise ValueError("Stage completion cannot precede its start")
        return self


class AnalysisResult(VersionedContract):
    retrieval: RetrievalResult | None
    knowledge_base: KnowledgeBase | None
    solver: SolverResult | None
    governance: GovernanceResult
    attempts: list[AnalysisAttempt]
    agents: list[str]
    stage_trace: list[AnalysisStep] = Field(default_factory=list)


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
