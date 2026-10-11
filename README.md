# DisputeFlow

DisputeFlow is an auditable, neuro-symbolic workspace for PayPal dispute handling. A coordinator delegates policy navigation, grounded extraction, deterministic ASP reasoning, governance, and merchant response execution to distinct agents. The React dashboard brings cases, evidence, reasoning, policy references, and human review into one interface.

The source specification is [`deepseek_markdown_20261005_70ab51.md`](deepseek_markdown_20261005_70ab51.md). It ends at the architecture diagram; API contracts, rule semantics, persistence and operational controls below are implementation choices, not additional requirements attributed to that document.

## Quick start

The interactive dashboard opens in synthetic demo mode and needs no API credentials or backend. Node.js 24 LTS and npm are required.

```sh
cd frontend
npm ci
npm run dev
```

Open http://localhost:5173. The demo contains synthetic disputes and supports case inspection, analysis, evidence updates, review, and simulated responses. Offline analysis replays recorded backend fixture outcomes, including actual clingo models and policy citations. Custom evidence combinations require the connected API for new computation. Changes stay in the demo workspace; reload restores the initial sample. No PayPal or LLM requests are made in this mode.

The overview leads with unresolved revenue under dispute and the next merchant evidence response to review. Exposure is shown in each claim's original currency. Open **Case totals** for readiness counts, or **Edit assumptions** for the optional labor-value calculator. Each case keeps the response, amount, deadline, and supporting evidence visible; **Case details** and **Decision details** reveal metadata and reasoning controls. **More tools** opens the planner, policy library, and audit view.

To run the dashboard against the actual local API and durable worker, install the backend once (Python 3.11 or newer):

```sh
python3 -m venv .venv
.venv/bin/pip install --constraint constraints.txt -e '.[dev]'
python3 scripts/dev.py
```

The launcher installs frontend dependencies if needed, starts all three processes, and seeds ten synthetic cases through the actual API. The worker computes and persists their real reasoning results. It uses a dedicated `.demo/disputeflow.db`, forces demo extraction and dry-run execution, and preserves existing demo cases on subsequent starts. Press Ctrl+C to stop the API, worker, and dashboard together. Backend logs are in `.demo/logs/`; use `--no-seed` to skip fixture insertion, or `--api-port` and `--frontend-port` to choose different ports.

Select **Connect API** in the dashboard and use the following local demo settings:

| Setting | Value |
| --- | --- |
| API base | `/api` |
| Service API key | `local-development-key-change-me` |
| Reviewer API key | `local-demo-reviewer-key-change-me` |

The Vite development server proxies `/api` to the backend; the launcher configures the proxy for the selected API port. Credentials are entered by the operator and are never compiled into browser assets. Connecting explicitly switches from the synthetic sample to backend cases. Service and reviewer roles remain enforced by the API. The connected interface reflects the API's configured execution mode; the launcher always uses `dry_run`.

For separate backend processes, or when using your own `.env` configuration:

```sh
python3 -m venv .venv
source .venv/bin/activate
pip install --constraint constraints.txt -e '.[dev]'
cp .env.example .env
disputeflow init-db
disputeflow serve
```

In a second terminal, start the durable worker:

```sh
source .venv/bin/activate
disputeflow worker
```

API reference: http://localhost:8000/docs. Health: `/health`; readiness: `/ready`.
The checked-in `openapi.json` exposes the dashboard's API contracts; regenerate it with `disputeflow export-openapi` after changing routes.

```sh
curl -s http://localhost:8000/v1/disputes \
  -H 'X-API-Key: local-development-key-change-me' \
  -H 'Content-Type: application/json' \
  --data-binary @examples/unique.json
# Copy the returned dispute id into CASE_ID.
curl -s "http://localhost:8000/v1/disputes/$CASE_ID/runs" \
  -H 'X-API-Key: local-development-key-change-me' \
  -H 'Content-Type: application/json' -d '{}'
# Poll GET /v1/runs/{run_id} until completed.
```

`disputeflow demo` runs the full reasoning pipeline locally and prints a reproducible result, including its proof graph. The demo is explicitly synthetic and makes no PayPal or LLM API calls.

## Revenue defense demo

The overview shows the original amounts of unresolved claims, grouped by currency. These amounts are at risk; they do not represent recovered revenue. Its next-claim action prioritizes current, complete merchant evidence recommendations with verified source content. Human review and an explicit response submission remain required by the applicable workflow. Legitimate claim acceptance stays available when the evidence supports it. The interface does not infer buyer history or repeated-refund behavior from data it does not hold.

**Edit assumptions** contains an optional estimate of monthly labor capacity value. These figures are projections, not measured performance, recovered dispute revenue, or a published software price. The illustrative defaults are 25 minutes of manual handling, 5 minutes of assisted handling, an hourly team cost of 35, 100 cases per month, and a monthly software cost of 99 in the selected scenario currency. Edited assumptions stay in memory while inspecting cases and switching workspace views; reloading the page restores the initial illustration.

Monthly time saved is `(manual minutes − assisted minutes) × monthly cases / 60`. Gross time value multiplies these hours by the hourly team cost; projected net value subtracts the monthly software cost. ROI divides net value by that software cost. With the defaults, this yields 33.3 hours per month, 1,166.67 in gross time value, 1,067.67 in projected net value, approximately 1,078% ROI, and a break-even volume of 9 cases. Zero software cost makes percentage ROI undefined; no positive value per case makes a positive-cost break-even unreachable. More assisted handling time than manual handling time produces a negative projection. These estimates do not establish cash savings or a probability of winning a dispute.

Disputed exposure is separate from the labor projection and grouped by original currency without currency conversion. Held cases, submitted responses, and dry-run execution journals remain unresolved exposure until the case status is `resolved`. A simulated response does not reduce the disputed amount. Operational readiness uses current evidence versions, completed analysis, allowed responses, recorded human review, and existing execution attempts; its counts update as the operator reviews and simulates cases. The next-response action opens an eligible case for inspection, prioritizing evidence-based merchant responses without presenting a fraud verdict or promising reimbursement.

## Architecture and semantics

1. A dispute and evidence are versioned and persisted. PayPal imports retain a provenance-marked API snapshot.
2. STAIR navigation descends the policy's hierarchical table of contents. It returns exact section text, path, version, URL, hash and a navigation trace. OpenAI selects sections in real mode; deterministic navigation is available for synthetic demos only.
3. The extractor returns validated facts, strict/defeasible rules, blocking defeaters and an acyclic superiority relation. Every rule and priority must quote a retrieved clause verbatim; every fact must reference supplied evidence. The model cannot provide executable ASP.
4. The compiler creates grounded ASP. Strong negation expresses contrary facts; default negation expresses exceptions. Priorities resolve conflicting applicable rules. Equally ranked opposing defeasible arguments admit alternative consistent extensions. Defeaters block contrary arguments without establishing their own conclusion. Facts and consequences supported exclusively by facts and strict rules prevail over defeasible rules. Strict continuations of defeasible premises retain their defeasible support; conflicts can defeat the upstream defeasible rule. The precise priority and exception behavior is documented in [Reasoning semantics v2](docs/REASONING_SEMANTICS.md).
5. Clingo enumerates stable models under time and model limits. Zero models trigger bounded re-extraction with diagnostics. Original inputs and each attempt are retained; unresolved inconsistency escalates. Complete enumeration yields skeptical and credulous conclusions. Incomplete enumeration cannot authorize execution.
6. Governance considers extraction confidence, verified evidence provenance, action consensus, complete enumeration, warnings, amount, currency and policy provenance. The operational score is **not** a calibrated probability of winning a dispute. Multiple models always require review, including when they suggest the same action.
7. The backend records a hash-linked audit log and graph connecting evidence, literals, rules, priorities and model decisions. The exact extracted knowledge base, retrieval, program and program hash are stored with the run.
8. Execution submits a permitted merchant response through PayPal after a fresh HATEOAS check. A merchant response does not let this application adjudicate a case on PayPal's behalf. Only PayPal can resolve contested claims.

Decision literals use `decision_accept_claim`, `decision_provide_evidence`, `decision_make_offer`, `decision_escalate`, `decision_send_message`, and `decision_no_action`. Domain symbols are validated identifiers; raw ASP from a model or API caller is never accepted.

## API

All `/v1` routes require `X-API-Key`. Reviewer operations accept the reviewer key; in development only, the service key also acts as reviewer when a separate key is absent. Production requires two distinct random keys of at least 32 characters. This is a single-merchant service; deploy separate instances and databases for separate merchants.

| Method | Endpoint | Purpose |
| --- | --- | --- |
| POST | `/v1/disputes` | Create a local dispute |
| GET | `/v1/disputes` | Paginated, filterable dashboard rows |
| GET | `/v1/disputes/{id}` | Case, latest run and evidence version |
| POST | `/v1/disputes/{id}/evidence` | Add or replace evidence; invalidate previous decision |
| POST | `/v1/disputes/{id}/evidence/{evidence_id}/verify` | Attest evidence provenance with a reviewer note |
| POST | `/v1/disputes/{id}/runs` | Enqueue durable analysis |
| GET | `/v1/runs/{id}` | Analysis, repairs and governance |
| GET | `/v1/runs/{id}/proof` | Graph JSON for the dashboard |
| GET | `/v1/runs/{id}/program` | Auditable ASP source |
| POST | `/v1/runs/{id}/review` | Approve an action or choose `no_action`; reviewer key |
| GET | `/v1/runs/{id}/review` | Restore the recorded review, or `null` when absent |
| GET | `/v1/runs/{id}/executions` | Restore a run's execution journal, newest first |
| POST | `/v1/runs/{id}/execute` | Submit or dry-run; reviewer key and `Idempotency-Key` |
| GET | `/v1/executions/{id}` | Execution journal |
| POST | `/v1/executions/{id}/reconcile` | Resolve an uncertain operation after checking PayPal; reviewer key |
| GET | `/v1/disputes/{id}/audit` | Timeline and hash-chain verification |
| GET | `/v1/reviews` | Cases requiring human review |
| GET | `/v1/metrics` | Dashboard counts |
| GET/POST | `/v1/policies` | List/import policy documents; import requires reviewer key |
| GET | `/v1/policies/{id}` | Full immutable policy document, including exact section text |
| GET | `/v1/policies/{id}/toc` | Policy table of contents |
| GET | `/v1/paypal/disputes` | Read the connected merchant's PayPal disputes |
| POST | `/v1/paypal/disputes/{id}/import` | Import a fresh dispute from PayPal |
| POST | `/webhooks/paypal` | Signature-verified, deduplicated event ingestion |

`POST /runs` returns HTTP 202. Workers claim jobs with database leases. New evidence makes existing results and approvals stale. Jobs that lose a lease cannot publish their result. Execution intent is committed before the external call; an interrupted external write is never automatically replayed. Use PostgreSQL for multiple workers; SQLite is suitable for local development and one worker.

Review and execution example:

```sh
curl -s "http://localhost:8000/v1/runs/$RUN_ID/review" \
  -H "X-API-Key: $REVIEWER_KEY" -H 'Content-Type: application/json' \
  -d '{"action":"accept_claim","note":"Reviewed the evidence and approved this response."}'
curl -s "http://localhost:8000/v1/runs/$RUN_ID/execute" \
  -H "X-API-Key: $REVIEWER_KEY" -H 'Idempotency-Key: review-001' \
  -H 'Content-Type: application/json' \
  -d '{"payload":{"note":"Reviewed refund acceptance."}}'
```

`make_offer` and `send_message` require an explicit payload. Notes-only `provide_evidence` and tracking/refund evidence are supported. Binary document uploads are not part of this API; submit documents through PayPal's multipart API before using evidence-dependent production workflows.

## Real LLM and policy documents

Configure `DISPUTEFLOW_LLM_PROVIDER=openai`, an API key, and a structured-output-capable model. The implementation uses the [OpenAI Responses API structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs?api-mode=responses) with `store=false`. `DISPUTEFLOW_OPENAI_MODEL` is configurable; the example default is `gpt-4.1-mini`. Tests use mock responses.

Import a reviewed, jurisdiction-appropriate policy tree using `POST /v1/policies`. Imported documents are stored immutably in the shared database and loaded by both API and worker; local files provide the bundled corpus. Schema: `PolicyDocument` in OpenAPI. Each section has an ID, title, exact text, children and optional navigation keywords. The bundled `policies/demo-policy.json` is a fictitious policy for explaining non-monotonic reasoning; it is never presented as PayPal's actual terms. A document's ID identifies an immutable version. To install a new version, use a new ID. Real policy documents must be supplied and reviewed by the operator; source URLs are provenance metadata and are not fetched automatically.

Evidence `verified=true` means the operator has verified its provenance; it does not establish the truth of every statement inside a document. Imported PayPal snapshots start unverified; a reviewer can attest provenance using the evidence verification endpoint, which preserves the text and creates a new case version. LLM grounding verifies evidence references and exact quotations, not semantic entailment. Human policy review remains necessary before enabling real automatic responses.

## PayPal sandbox and live operation

Exact backend and dashboard fields, startup steps, and reproducible internal-engine claim checks are documented in [docs/LIVE_SETUP.md](docs/LIVE_SETUP.md). The latest synthetic verification report is [artifacts/demo-claims-verification.json](artifacts/demo-claims-verification.json).

Create a PayPal Developer REST application with access to the Disputes API. Enable the `CUSTOMER.DISPUTE.CREATED`, `CUSTOMER.DISPUTE.UPDATED`, and `CUSTOMER.DISPUTE.RESOLVED` webhooks pointing to `/webhooks/paypal`. Set client ID, secret, webhook ID and an imported policy ID. Refer to the official [Disputes API](https://developer.paypal.com/api/customer-disputes/v1) and [webhook verification](https://developer.paypal.com/api/rest/webhooks/rest/) contracts.

`execution_mode=dry_run` is the default. `sandbox` requires sandbox credentials; `live` requires live credentials. Changing this setting is the explicit deployment control for real external writes. Synthetic policies are rejected for real execution even after review. A fresh imported PayPal case is required for real execution; local/manual cases can only dry-run. OAuth tokens are cached in memory. Read requests may retry bounded transient failures; dispute action writes are never retried automatically.

The official dispute endpoints do not document upstream idempotency support. DisputeFlow enforces local idempotency per run and execution mode. Reusing a key with a different request returns 409. A timeout, server failure, or process interruption can leave the outcome uncertain. Check PayPal, then use the reconciliation endpoint with an explanatory note. Reconciliation records what the operator observed; it never resubmits the original action. New evidence/imports are blocked while an external operation is unresolved.

Automatic execution additionally requires `auto_execute=true` on the case and `execute=true` on the run request, a unique complete model, a single permitted action, verified provenance, no warnings, a real policy, configured score threshold, and a compatible amount/currency limit. Complex payloads require explicit reviewed execution.

## Operations and validation

```sh
pytest
ruff check .
alembic upgrade head
```

Development can create the schema with `init-db`. Production uses Alembic before starting the API and worker. `.env.example` lists settings. `compose.yaml` runs the dashboard, API, worker, and PostgreSQL:

```sh
docker compose up --build
```

The dashboard is available at http://localhost:8080; nginx serves its static build and proxies `/api` to the API container. Compose does not seed disputes: the offline sample is immediately available, and connected mode reads the database or cases created/imported through the API. Default Compose service key: `local-development-key-change-me`; default reviewer key: `local-compose-reviewer-key-change-me`. Override these values in `.env` for other environments. No API key is embedded in the dashboard image.

The frontend build and browser checks run independently:

```sh
cd frontend
npm run build
npx playwright install chromium
npm run test:e2e
npm run format:check
```

The interface self-hosts PayPal Open Regular, Medium, and Bold in `frontend/public/fonts/`, using the assets referenced by PayPal's [official font stylesheet](https://www.paypalobjects.com/paypal-ui/web/fonts-and-normalize/3-1-0/fonts-and-normalize.min.css). The product palette follows PayPal's [Help Center stylesheet](https://www.paypalobjects.com/web/res/helpcenter/_next/static/css/59845238f6c58699.css?dpl=2.141.0_20261005084452169): action blue `#0066f5`, navy `#002991`, and surface `#f5f7fa`. Bundled fonts let the demo render with the same typography without a runtime font download.

The response planner uses the actual [Bryntum Scheduler](https://bryntum.com/products/scheduler/docs-llm/guide/Scheduler/quick-start/javascript-npm.md) trial package. Trial branding and license notices remain visible. Replace the trial alias with your licensed Bryntum package and configure its registry before production use. The planner is read-only and opens case review when an event is selected. Synthetic due dates are confined to demo fixtures; API cases without a supplied deadline are not assigned invented dates.

[render.yaml](render.yaml) follows the [Render Blueprint contract](https://render.com/docs/blueprint-spec) and provides an API, separate worker and database. It does not deploy the new dashboard. Configure provider secrets in its shared environment group before enabling real mode. No deployment is performed by this repository.

Run API and worker from the same project directory or configure an absolute policy directory. Both must share the database and deploy the same bundled policy files; policies imported through the API automatically reach all workers via the database. The API exposes no secret values in responses. Keys and personal dispute evidence must be protected by the operator's hosting access controls. Audit hashes detect changes relative to the stored chain head; they are not an external signature or proof against an administrator who rewrites the entire database. Export and externally anchor audit heads if independent tamper evidence is required.

The test suite covers retrieval, exact citation validation, mocked structured LLM responses, model branching, priority overrides, new evidence invalidating conclusions, inconsistent facts, timeout/model limits, governance, API authentication, durable jobs, stale review rejection, webhook replay, local execution idempotency and uncertain-operation reconciliation. Real PayPal/OpenAI credentials and Docker are not required by the suite; external access and hosting depend on your own accounts.

## Submission materials

Code and technical documentation are in English, and an MIT license is included. Publishing a public GitHub repository and recording a demo video under three minutes are operator tasks. Hackathon dates and prizes in the input specification are not used as runtime rules.
