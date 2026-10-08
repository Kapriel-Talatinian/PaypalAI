"""Independent deterministic provenance verification outside every producer.

Checks structure, evidence references, authoritative policy content, hashes and
verbatim citations. This does not prove that a quoted clause entails an LLM's
interpretation or that evidence is true; semantic entailment is a separate gate.
"""

import hashlib
import json
from decimal import Decimal

from .domain import (
    Action,
    AnalysisResult,
    AnalysisStep,
    CaseInput,
    ExtractionInput,
    ExtractionOutput,
    GovernanceInput,
    GovernanceOutput,
    GovernanceResult,
    PolicyDocument,
    PolicyRetrievalInput,
    PolicyRetrievalOutput,
    PolicySection,
    ReasoningInput,
    ReasoningOutput,
    RetrievalResult,
    SolverResult,
    VerificationInput,
    VerificationOutput,
    VerificationResult,
)
from .reasoning import compile_program


class VerificationError(ValueError):
    def __init__(self, code: str, message: str):
        self.code = code
        super().__init__(message)


def contract_hash(value) -> str:
    data = value.model_dump(mode="json") if hasattr(value, "model_dump") else value
    text = json.dumps(data, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha256(text.encode()).hexdigest()


def verify_retrieval(retrieval: RetrievalResult, document: PolicyDocument) -> None:
    """Compare retrieval to the operator-owned policy, never extractor metadata."""
    if (
        retrieval.policy_id != document.id
        or retrieval.policy_version != document.version
        or retrieval.synthetic != document.synthetic
        or retrieval.authoritative_vocabulary != document.authoritative_vocabulary
    ):
        raise VerificationError("policy_identity", "Retrieved policy metadata is not authoritative")
    sources: dict[str, tuple[PolicySection, list[str]]] = {}

    def walk(sections, path):
        for section in sections:
            current = [*path, section.title]
            sources[section.id] = (section, current)
            walk(section.children, current)

    walk(document.sections, [])
    if not retrieval.clauses or len({c.id for c in retrieval.clauses}) != len(retrieval.clauses):
        raise VerificationError(
            "policy_clauses", "Retrieval has no clauses or duplicate clause IDs"
        )
    for clause in retrieval.clauses:
        source = sources.get(clause.id)
        if source is None:
            raise VerificationError("policy_source", "Retrieved clause is not in the source policy")
        section, path = source
        if (
            clause.text != section.text
            or clause.title != section.title
            or clause.section_path != path
            or clause.source_url != document.source_url
            or clause.version != document.version
        ):
            raise VerificationError(
                "policy_source", "Retrieved clause differs from its source policy"
            )
        if clause.sha256 != hashlib.sha256(section.text.encode()).hexdigest():
            raise VerificationError("source_hash", "Retrieved clause has an invalid source hash")


def verify_knowledge(request: VerificationInput) -> VerificationResult:
    """Revalidate copies so mutated or model_construct producer objects cannot bypass us."""
    request = VerificationInput.model_validate(request.model_dump(mode="json"))
    case, retrieval, knowledge = request.case, request.retrieval, request.knowledge_base
    if retrieval.policy_id != case.policy_id:
        raise VerificationError(
            "policy_identity", "Retrieved policy does not match the case policy ID"
        )
    evidence_ids = {item.id for item in case.evidence}
    clauses = {clause.id: clause for clause in retrieval.clauses}
    if len(clauses) != len(retrieval.clauses):
        raise VerificationError("policy_clauses", "Retrieval contains duplicate clause IDs")
    for clause in retrieval.clauses:
        if clause.version != retrieval.policy_version:
            raise VerificationError("policy_version", "Retrieved clause has a mismatched version")
        if clause.sha256 != hashlib.sha256(clause.text.encode()).hexdigest():
            raise VerificationError("source_hash", "Retrieved clause has an invalid source hash")
    for fact in knowledge.facts:
        if not fact.evidence_ids or not set(fact.evidence_ids) <= evidence_ids:
            raise VerificationError("evidence_reference", "Fact references unavailable evidence")
        if fact.literal.name.startswith("decision_"):
            raise VerificationError(
                "decision_fact", "Decisions must derive from cited policy rules"
            )
    citation_count = 0
    for owner in [*knowledge.rules, *knowledge.priorities]:
        for citation in owner.citations:
            clause = clauses.get(citation.clause_id)
            if clause is None:
                raise VerificationError(
                    "citation_reference", "Policy citation references an unavailable clause"
                )
            if not citation.quote.strip() or citation.quote not in clause.text:
                raise VerificationError(
                    "citation_quote", "Citation quote is not an exact substring of its clause"
                )
            citation_count += 1
    if request.previous:
        verified_ids = {item.id for item in case.evidence if item.verified}
        required = {
            fact.literal.key()
            for fact in request.previous.facts
            if fact.evidence_ids and set(fact.evidence_ids) <= verified_ids
        }
        if not required <= {fact.literal.key() for fact in knowledge.facts}:
            raise VerificationError(
                "verified_fact_removed", "Correction removed a fact backed by verified evidence"
            )
    return VerificationResult(
        valid=True,
        checked_fact_ids=[fact.id for fact in knowledge.facts],
        checked_clause_sha256={clause.id: clause.sha256 for clause in retrieval.clauses},
        checked_citations=citation_count,
        knowledge_base_sha256=contract_hash(knowledge),
    )


def reconstruct_stage(
    step: AnalysisStep, result: AnalysisResult, case: CaseInput, policy: PolicyDocument
):
    """Rebuild successful component contracts from compact persisted references.

    Audit events contain stage metadata and hashes only. Evidence is retained in
    the existing run input snapshot; each accepted KB/intermediate solver occurs
    once in the result/attempts. No repeated evidence bodies enter stage events.
    Immutable policy ID/content must remain available to reconstruct retrieval.
    """
    if step.status != "succeeded":
        raise ValueError("Rejected producer outputs are intentionally unavailable for replay")
    if step.component == "policy_retrieval":
        return (
            PolicyRetrievalInput(case=case, policy=policy, max_clauses=step.max_clauses),
            PolicyRetrievalOutput(retrieval=result.retrieval),
        )
    attempt = next((item for item in result.attempts if item.attempt == step.attempt), None)
    if attempt is None:
        raise ValueError("Recorded attempt is unavailable")
    previous = next(
        (
            item.knowledge_base
            for item in reversed(result.attempts)
            if item.attempt < step.attempt and item.status == "inconsistent"
        ),
        None,
    )
    if step.component == "extraction":
        preceding = next(
            (item for item in result.attempts if item.attempt == step.attempt - 1), None
        )
        return (
            ExtractionInput(
                case=case,
                retrieval=result.retrieval,
                previous=previous,
                diagnostics=preceding.diagnostics if preceding else [],
            ),
            ExtractionOutput(knowledge_base=attempt.knowledge_base),
        )
    if step.component == "verification":
        return (
            VerificationInput(
                case=case,
                retrieval=result.retrieval,
                knowledge_base=attempt.knowledge_base,
                previous=previous,
            ),
            VerificationOutput(verification=step.verification),
        )
    solver = attempt.solver or result.solver
    if step.component == "asp_reasoning":
        return (
            ReasoningInput(
                knowledge_base=attempt.knowledge_base,
                authoritative_vocabulary=result.retrieval.authoritative_vocabulary,
                max_models=step.max_models,
                timeout_seconds=step.timeout_seconds,
            ),
            ReasoningOutput(solver=solver),
        )
    return (
        GovernanceInput(
            case=case,
            retrieval=result.retrieval,
            knowledge_base=attempt.knowledge_base,
            solver=solver,
            controls=step.governance_controls,
        ),
        GovernanceOutput(governance=result.governance),
    )


def verify_reasoning(request: ReasoningInput, result: SolverResult) -> None:
    """Bind deterministic reasoning output to its KB, program and model literals."""
    if result.program != compile_program(request.knowledge_base):
        raise VerificationError(
            "program_input", "Solver program does not compile from the validated knowledge base"
        )
    if result.program_sha256 != hashlib.sha256(result.program.encode()).hexdigest():
        raise VerificationError("program_hash", "Solver program failed its source hash check")
    rule_ids = {rule.id for rule in request.knowledge_base.rules}
    fact_keys = {fact.literal.key() for fact in request.knowledge_base.facts}
    models = []
    for model in result.models:
        keys = {literal.key() for literal in model.literals}
        if len(keys) != len(model.literals) or not fact_keys <= keys:
            raise VerificationError(
                "model_facts", "Stable model omits supplied facts or duplicates literals"
            )
        if any((key[1:] if key.startswith("-") else "-" + key) in keys for key in keys):
            raise VerificationError("model_consistency", "Stable model contains opposing literals")
        if not set(model.applied_rules + model.defeated_rules) <= rule_ids:
            raise VerificationError(
                "model_rule_reference", "Stable model references an unavailable rule"
            )
        if set(model.applied_rules) & set(model.defeated_rules):
            raise VerificationError(
                "model_rule_status", "Stable model both applies and defeats the same rule"
            )
        expected_actions = {action for action in Action if f"decision_{action.value}" in keys}
        if set(model.decisions) != expected_actions or len(model.decisions) != len(
            expected_actions
        ):
            raise VerificationError(
                "model_decisions",
                "Stable model decisions do not match its positive decision literals",
            )
        models.append(keys)
    union = set.union(*models) if models else set()
    intersection = set.intersection(*models) if models and result.enumeration_complete else set()
    if {literal.key() for literal in result.credulous} != union or {
        literal.key() for literal in result.skeptical
    } != intersection:
        raise VerificationError(
            "model_entailment", "Solver entailment summaries do not match the returned models"
        )
    if (
        (result.status == "unique" and (len(models) != 1 or not result.enumeration_complete))
        or (result.status == "multiple" and (len(models) < 2 or not result.enumeration_complete))
        or (result.status == "inconsistent" and (models or not result.enumeration_complete))
        or (result.status in {"timeout", "truncated"} and result.enumeration_complete)
    ):
        raise VerificationError(
            "solver_status", "Solver status contradicts its enumeration metadata"
        )


def verify_governance(request: GovernanceInput, result: GovernanceResult) -> None:
    """Independently check safety claims before consuming a governance output."""
    case, kb, retrieval, solver = (
        request.case,
        request.knowledge_base,
        request.retrieval,
        request.solver,
    )
    evidence = {item.id: item for item in case.evidence}
    references = {reference for fact in kb.facts for reference in fact.evidence_ids}
    provenance = (
        sum(
            bool(evidence.get(reference) and evidence[reference].verified)
            for reference in references
        )
        / len(references)
        if references
        else 0.0
    )
    extraction = min([kb.confidence, *(fact.confidence for fact in kb.facts)])
    actions = []
    for model in solver.models:
        executable = [action for action in model.decisions if action != Action.NO_ACTION]
        if len(executable) == 1 and Action.NO_ACTION not in model.decisions:
            actions.append(executable[0])
    consensus = max((actions.count(action) for action in set(actions)), default=0) / max(
        len(solver.models), 1
    )
    complete = float(solver.enumeration_complete and bool(solver.models))
    score = round(extraction * provenance * consensus * complete, 6)
    recommended = (
        actions[0]
        if actions and len(set(actions)) == 1 and len(actions) == len(solver.models)
        else None
    )
    if result.recommended_action != recommended or result.confidence != score:
        raise VerificationError(
            "governance_decision",
            "Governance action or confidence differs from the validated solver and evidence",
        )
    required_review = (
        solver.status != "unique"
        or not solver.enumeration_complete
        or recommended is None
        or recommended not in case.allowed_actions
        or provenance < 1
        or score < request.controls.auto_confidence_threshold
        or bool(kb.warnings)
        or retrieval.synthetic
        or any(detail.severity in {"warning", "error"} for detail in solver.diagnostic_details)
        or case.amount > Decimal(str(request.controls.auto_max_amount))
        or case.currency != request.controls.auto_currency
    )
    if (required_review or result.reasons) and not result.requires_human:
        raise VerificationError(
            "governance_controls", "Governance bypassed a required human review control"
        )
