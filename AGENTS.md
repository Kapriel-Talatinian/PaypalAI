# Agent instructions

These instructions apply to the entire repository. Keep code, tests and technical documentation in English.

## Start with the relevant contract

- Read [README.md](README.md) for setup and product behavior. The source specification linked there ends at its architecture diagram; distinguish its requirements from implementation choices.
- Before changing rule compilation, defeat, priorities, exceptions, proof graphs or solver outcomes, read [docs/REASONING_SEMANTICS.md](docs/REASONING_SEMANTICS.md). Update that document and regression tests when changing semantics.
- Before changing PayPal integration, execution modes or deployment configuration, read [docs/LIVE_SETUP.md](docs/LIVE_SETUP.md) and the corresponding workflow tests.
- Inspect the current branch and working tree before editing. Preserve existing work and running demos. When using a separate worktree, ensure its Python imports resolve to that worktree rather than another editable installation.

## Preserve domain boundaries

- The LLM extracts source-grounded knowledge; the ASP solver establishes logical outcomes; governance determines whether review or execution is permitted. Keep these responsibilities separate.
- Facts reference supplied evidence. Rules and priorities quote retrieved clauses exactly. Preserve policy versions, provenance and verified evidence through correction attempts.
- Keep ambiguity, contradictory evidence, unsupported formalization and infrastructure failures distinguishable. Solver failures or admissible ambiguity must not be hidden by rewriting extracted rules.
- Preserve complete-enumeration checks, human review, evidence-version invalidation, worker leases and audit history when changing the workflow.
- PayPal actions are merchant responses. UI text and API behavior must not imply that the application adjudicates disputes or guarantees recovery.

## Work locally without external side effects

Use demo extraction, synthetic cases and `dry_run` for development and verification. Tests use provider doubles; real PayPal or OpenAI credentials are unnecessary. Keep secrets and personal dispute evidence out of commits, logs and fixtures.

Preserve the execution boundary: fresh allowed-action checks, reviewer authorization and local idempotency. An uncertain external write requires reconciliation; do not automatically replay it. Keep synthetic policies ineligible for real execution.

For UI changes, distinguish offline fixture replay from connected backend computation. Keep claim amounts in their original currencies and label projected savings as estimates. Preserve bundled font and third-party license notices.

## Implement and validate

1. For a behavior fix, reproduce the failure at the relevant public boundary and add a regression test that checks the intended result. Keep unrelated refactors out of the change.
2. Use the dependency and tool settings in `pyproject.toml`, `constraints.txt` and `frontend/package.json`. Install backend development dependencies with `pip install --constraint constraints.txt -e '.[dev]'`; use `npm ci` in `frontend`.
3. Run checks appropriate to the affected behavior:

   | Change | Validation |
   | --- | --- |
   | Backend | From the repository root: `ruff check .` and `pytest` |
   | Reasoning or orchestration | Also run `disputeflow demo`; verify models, proof provenance and repair behavior |
   | Database models or migrations | `alembic upgrade head` then `alembic check` against a disposable database |
   | Frontend | From `frontend`: `npm run build`, `npm run format:check`, and relevant `npm run test:e2e -- <spec>` checks |
   | API contracts | Regenerate `openapi.json` with `disputeflow export-openapi`; reconcile frontend types, clients and affected contract tests |
   | Documentation only | Verify referenced paths and commands, then `git diff --check`; runtime tests are unnecessary |

   The backend CI definition is [.github/workflows/ci.yml](.github/workflows/ci.yml). Install Playwright Chromium if required by the browser tests. Use an isolated `DISPUTEFLOW_DATABASE_URL` for migration checks, leaving existing local cases intact.

4. Report the behavior changed, checks actually run and any remaining limitation. Describe intermittent failures and reruns accurately; retain timeout and model-cap safeguards. When publishing a requested PR, link the issues and explain any change to the accepted rule language.
