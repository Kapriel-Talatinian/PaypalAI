# Reasoning semantics v2

This is the implemented propositional semantics, not a claim of compliance with
an external argumentation calculus. The compiled program and proof root carry
version 2. Persisted version 1 runs remain historical records; rerunning a case
uses version 2 and produces a new program hash.

## Strict support and defeasible roots

Facts hold in every extension. A strict rule applies whenever every body literal
holds and none of its `unless` literals holds. It is never defeated. A literal
has **definite support** only if it is a fact or follows from a strict rule whose
premises all have definite support (and whose exceptions are absent).

A strict continuation of a defeasible premise therefore does not acquire
unconditional protection. When its consequence loses a conflict, the upstream
defeasible rule can be defeated; the strict implication itself stays mandatory.
A new defeasible step begins a new root for priority comparison.

For example:

- `seller: => -decision_accept_claim` (defeasible)
- `contest: -decision_accept_claim -> decision_provide_evidence` (strict)
- `hold: => -decision_provide_evidence` (defeasible), `hold > seller`

The unique extension contains `-decision_provide_evidence`; `seller` is defeated
and `contest` is inapplicable. Without a priority, opposing defeasible chains
may have alternative consistent extensions. Genuine opposing facts, or opposing
conclusions derived exclusively from definite premises, remain inconsistent.

## Conflicts, priorities and conjunctions

For each applicable defeasible rule, the compiler computes the strict closure
of its candidate head together with the current extension. It tracks which
consequences depend on that root. A root loses when one of these consequences
opposes definite support, opposes the support of an applied root that it does
not outrank, or contradicts another of its own strict consequences.

Priorities are transitive and compare defeasible roots, including when the
conflict occurs after several strict steps. A priority mentioning a strict rule
does not turn it into a defeasible rule or defeat fact-rooted support.

All premises of a conjunctive strict rule must be present. Its consequence can
carry several roots; comparisons are pairwise, not a weakest-premise or total
ranking of the whole argument. For `a => a`, `b => b`, strict `a,b -> c`, and
`d => -c`, with `b > d > a`, the semantics admits both `{a,b,c}` and `{b,-c}`.
In the former, `b` supports the attack on `d`; in the latter, `d` defeats `a`.
This ambiguity is retained for human review. Independent derivations are not
silently discarded to satisfy a preference.

Defeaters supply blocking support without deriving their heads or extending
through strict rules. They yield to definite support or a superior opposing
root. A defeater can block a consequence at the end of a strict continuation.

## Exceptions and the accepted fragment

Strong negation (`-p`) is a separate literal, not absence of `p`. Exceptions
(`unless`) test absence and keep their existing stable-model interpretation for
defeasible rules.

**Strict exceptions must be stratified.** The graph includes every strict head's
dependencies on both body and exception literals. Any cycle containing an
exception dependency is rejected with `UnsupportedTheoryError`, identifying the
exception rules. Purely positive cycles are allowed and cannot invent support.
For example, strict `p -> q unless q`, and mutually exceptional strict rules,
are outside the accepted fragment, even if their premises happen to be absent.
Acyclic exceptions can depend on other strict consequences of a candidate.

This explicit restriction prevents hypothetical exception cycles from creating
false inconsistencies or duplicate extensions. It is a change to the accepted
input fragment, not evidence that a dispute itself is contradictory.

## Outcomes, repairs and proofs

- `unique` / `multiple`: complete enumeration of consistent extensions. An
  ambiguous result is preserved; it does not request another LLM extraction.
- `inconsistent`: no stable extension in the supported language, including
  contradictory evidence. The existing bounded extraction-repair path remains;
  verified facts cannot be discarded by a correction.
- `unsupported_formalization`: analysis stops with the extracted knowledge,
  diagnostics and mandatory human review, with no solver result or LLM retry.
  This is an analysis-attempt status, not a new `SolverResult` status.
- Infrastructure failures still raise `SolverError`; timeout/model-cap results
  retain their existing safeguards against claiming skeptical entailment.

The proof includes the actual ASP witnesses for each defeat: the opposing
applied root, the conflicting consequence, definite opposition or internal
conflict. These witnesses describe indirect conflicts without relabeling a
revocable strict continuation as definite support.

Regression coverage is in `tests/test_reasoning.py` and `tests/test_workflow.py`;
the latter verifies persistence, human-review routing, and absence of retries
for ambiguity and unsupported formalization.
