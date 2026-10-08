# Component contracts and analysis replay

The coordinator orchestrates policy retrieval, extraction, independent provenance verification, ASP reasoning, and governance. These are explicit component boundaries, not autonomous processes with separate execution authority. Only policy selection and extraction call the configured LLM. The demo extractor and demo selector are deterministic fixture interpreters. Verification, compilation, clingo, governance, and execution guards are deterministic.

## Versioned boundaries

The Pydantic contracts in [`domain.py`](../src/disputeflow/domain.py) reject additional fields and unsupported versions. Each input/output envelope declares `contract_version: "1.0"` and a fixed `component`. The coordinator revalidates producer output outside the producer, including already constructed model objects. Producer inputs are defensive copies of the recorded input.

| Component | Input | Output | Independent checks |
| --- | --- | --- | --- |
| Policy selection | `PolicySelectionInput`: case, offered headings, current path | `PolicySelectionOutput`: section IDs | IDs belong to the current level; no duplicates; no invented sections |
| Policy retrieval | `PolicyRetrievalInput`: case, immutable policy, clause limit | `PolicyRetrievalOutput`: clauses and navigation trace | Identity, version, vocabulary, section paths, exact text, URLs and SHA-256 match the operator-owned policy |
| Extraction | `ExtractionInput`: case, retrieval, previous KB and repair diagnostics | `ExtractionOutput`: typed knowledge base | External schema validation followed by the separate verifier |
| Verification | `VerificationInput`: case, retrieval, KB and previous KB | `VerificationOutput`: bounded verification summary | Evidence references, decision-fact rejection, source hashes, exact rule/priority quotations and retention of facts backed by verified evidence during repair |
| ASP reasoning | `ReasoningInput`: KB, authoritative vocabulary, model/time limits | `ReasoningOutput`: solver result | Program equals compilation of the accepted KB; program hash, fact/model consistency, rule references, decision literals, enumeration status and entailment summaries agree |
| Governance | `GovernanceInput`: case, retrieval, KB, solver and explicit controls | `GovernanceOutput`: operational score and review decision | Score and response derive from the accepted artifacts; warnings, provenance, amount/currency, incomplete enumeration and other required review controls cannot be bypassed |

The verifier reports `scope: "references_hashes_exact_quotes"` and `semantic_entailment_checked: false`. A valid reference or quotation does not prove that evidence entails a fact or that a policy clause supports an interpretation. Evidence provenance attestation also does not prove the truth of every assertion. Semantic entailment verification remains separate work; these contracts do not claim to implement it.

## Reasoning diagnostics

`SolverResult.diagnostic_details` contains a stable diagnostic code, severity (`error`, `warning`, `info`), message, affected fact/rule IDs and literals, and possible spelling suggestions. The original string `diagnostics` remains available for older clients.

The analyzer detects unsupported positive rule bodies, unreachable rules, unseeded dependency cycles, vocabulary drift, unknown predicates when a reviewed vocabulary is supplied, irrelevant facts, and models without an executable response. Its conservative dependency analysis does not change the compiled ASP or treat a missing default-negated exception as a missing fact. Similar-name suggestions never rename predicates automatically. Warnings and errors require human review; informational notes alone do not.

An optional `PolicyDocument.authoritative_vocabulary` lists the domain predicate names approved by the policy owner. Retrieval carries this same list; the extractor cannot supply or replace it. Decision atoms are reserved by the engine. With `null` or an omitted field, the allowlist check is disabled while dependency and spelling diagnostics still run. A unique model with no merchant response is displayed as **More information needed**, rather than a certain executable recommendation.

## Durable trace and replay

Every analysis stage records component, contract version, deterministic/probabilistic mode, attempt number, start/end times, elapsed duration, input/output hashes, status, sanitized error code, diagnostics, and coordinator decision. Successful policy navigation also records offered/selected IDs and contract hashes in `retrieval.trace`. Stage events join the case's existing hash-linked audit chain. Failed analysis keeps its trace and accepted intermediate artifacts, including when a component fails or analysis times out; failed runs cannot be reviewed or executed.

Trace entries retain compact references and bounded controls/verification summaries. Full evidence and policy text are not copied into each audit event. The run input snapshot retains the case; the immutable policy, retrieval, attempts, accepted KB and solver retain the actual content. [`verification.reconstruct_stage`](../src/disputeflow/verification.py) rebuilds successful stage contracts from these artifacts. Compare `contract_hash()` of reconstructed input and output to the recorded hashes. Reconstruction tests cover normal analysis, bounded repair, rejection, component failure and timeout. Rejected producer payloads are intentionally discarded and cannot be replayed as accepted results.

The repair limit remains `max_repair_attempts`. Contract verification and diagnostics add no LLM calls. Execution remains a separate reviewed merchant-response workflow with a fresh PayPal snapshot/action check; passing a component contract does not authorize a provider write.

## Compatibility

Previously persisted analysis results receive the default contract version and an empty stage trace. Historical string diagnostics remain readable. New PayPal metadata and policy vocabulary fields are optional, and unchanged historical policy JSON can be reimported without changing its immutable stored content. There is no database migration: these additions live in existing JSON documents. Unsupported future contract versions are rejected explicitly.
