"""Explicit conservative controls; score is operational confidence, not a win probability."""

from decimal import Decimal

from .config import Settings
from .domain import (
    Action,
    CaseInput,
    GovernanceResult,
    KnowledgeBase,
    RetrievalResult,
    SolverResult,
)


def evaluate(
    case: CaseInput,
    kb: KnowledgeBase,
    retrieval: RetrievalResult,
    solver: SolverResult,
    settings: Settings,
) -> GovernanceResult:
    reasons: list[str] = []
    evidence = {e.id: e for e in case.evidence}
    fact_ids = {eid for f in kb.facts for eid in f.evidence_ids}
    verified = sum(bool(evidence.get(eid) and evidence[eid].verified) for eid in fact_ids)
    provenance = verified / len(fact_ids) if fact_ids else 0.0
    extraction = min([kb.confidence, *(f.confidence for f in kb.facts)])
    actions: list[Action] = []
    for model in solver.models:
        executable = [action for action in model.decisions if action != Action.NO_ACTION]
        if len(executable) == 1 and Action.NO_ACTION not in model.decisions:
            actions.append(executable[0])
    consensus = max((actions.count(a) for a in set(actions)), default=0) / max(
        len(solver.models), 1
    )
    complete = float(solver.enumeration_complete and bool(solver.models))
    score = round(extraction * provenance * consensus * complete, 6)
    recommended = (
        actions[0]
        if actions and len(set(actions)) == 1 and len(actions) == len(solver.models)
        else None
    )
    if solver.status != "unique":
        reasons.append(f"Solver status '{solver.status}' requires human review")
    if recommended is None:
        reasons.append("No unambiguous executable merchant action")
    if recommended and recommended not in case.allowed_actions:
        reasons.append("Action is not currently allowed for this dispute")
    if provenance < 1:
        reasons.append("Some facts lack verified evidence provenance")
    if score < settings.auto_confidence_threshold:
        reasons.append("Operational confidence is below the automatic execution threshold")
    if kb.warnings:
        reasons.append("Extraction warnings require human review")
    if (
        case.amount > Decimal(str(settings.auto_max_amount))
        or case.currency != settings.auto_currency
    ):
        reasons.append("Amount or currency is outside the configured automatic execution limit")
    if retrieval.synthetic:
        reasons.append("Synthetic policy is limited to demo and dry-run execution")
    return GovernanceResult(
        recommended_action=recommended,
        confidence=score,
        requires_human=bool(reasons),
        reasons=reasons,
        components={
            "extraction": extraction,
            "verified_provenance": provenance,
            "action_consensus": consensus,
            "complete_enumeration": complete,
        },
    )
