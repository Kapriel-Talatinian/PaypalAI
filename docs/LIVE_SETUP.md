# Live setup and verified demo claims

The internal pipeline has been exercised through actual FastAPI routes, the durable worker, and clingo 5.8.0 in an isolated temporary database. This verifies synthetic reasoning mechanics, source citations, persisted decisions, review gates, explicit dry-run execution, local idempotency, and audit integrity. It does not establish the quality of real OpenAI extraction or successful PayPal sandbox/live operation.

## Reproduce the claim verification

Run from the repository root after installing the backend development dependencies:

```sh
.venv/bin/python scripts/verify_demo_claims.py
```

The script ignores inherited `DISPUTEFLOW_*` settings and `.env`, uses temporary authentication keys and a temporary database, forces demo extraction and dry-run execution, and blocks external HTTP transports. It never modifies the running demo database. Its assertions stop execution on a failed check; the report is written only after all checks pass.

The report is [artifacts/demo-claims-verification.json](../artifacts/demo-claims-verification.json). Six analysis runs perform eight solver attempts because the contradictory case exercises bounded re-extraction.

| Synthetic claim | Observed solver result | Observed recommendation |
| --- | --- | --- |
| Nonreceipt with verified delivery | One stable model | `provide_evidence` |
| Same claim after verified invalid-tracking correction | One stable model, evidence version 2 | `accept_claim`; previous review and execution authorization rejected as stale |
| Verified item mismatch without contrary seller inspection | One stable model | `accept_claim` |
| Buyer quality complaint and competing seller inspection | Two stable models | Human decision required |
| Positive and negative verified delivery assertions | No stable model after bounded repair | Human decision required; both verified assertions preserved |
| Nonreceipt with unverified carrier tracking | One stable model | `accept_claim`; unverified delivery is not promoted to a fact |

These outcomes use the bundled fictitious policy and explicit `FACT:` markers. The demo extractor is a fixture interpreter, not a general language model. Real claims need the OpenAI extractor and reviewed real policy clauses. A recommendation to submit evidence is a merchant response, not a fraud verdict or a PayPal adjudication.

Additional verified checks: execution before review returns 409; a service key cannot record a reviewer decision (403); the same idempotency key and payload return the same execution without another journal entry; reusing a key with a different payload returns 409; the explicit operator payload is preserved; ASP hashes and proof endpoints match persisted results; audit chains verify independently and detect modified event data. No payment or external message is sent.

## Backend fields

Fill backend settings in the server's `.env` or hosting secret configuration. Provider credentials are not dashboard fields.

| Setting | Required value or source |
| --- | --- |
| `DISPUTEFLOW_ENVIRONMENT` | `production` for a deployed production service |
| `DISPUTEFLOW_PAYPAL_ENVIRONMENT` | `live` for real merchant data; `sandbox` for provider testing |
| `DISPUTEFLOW_PAYPAL_CLIENT_ID` | Client ID of the merchant's corresponding Live or Sandbox REST app |
| `DISPUTEFLOW_PAYPAL_CLIENT_SECRET` | Secret of that same app and environment |
| `DISPUTEFLOW_EXECUTION_MODE` | `dry_run` to analyze without submitting responses; `sandbox` or `live` to submit to the matching PayPal environment |
| `DISPUTEFLOW_LLM_PROVIDER` | `openai` for real policy extraction |
| `DISPUTEFLOW_OPENAI_API_KEY` | Server-side API key with access to the configured model |
| `DISPUTEFLOW_OPENAI_MODEL` | Your structured-output-capable model; the code's default is `gpt-4.1-mini` |
| `DISPUTEFLOW_API_KEY` | A random service key of at least 32 characters |
| `DISPUTEFLOW_REVIEWER_API_KEY` | A different random reviewer key of at least 32 characters |
| `DISPUTEFLOW_PAYPAL_WEBHOOK_ID` | ID of the webhook registered on this app, required for webhook verification; not required for manual imports |
| `DISPUTEFLOW_WEBHOOK_POLICY_ID` | Exact ID of an imported, reviewed, nonsynthetic policy used for webhook-created cases |
| `DISPUTEFLOW_DATABASE_URL` | Shared database URL for native API and worker processes; use PostgreSQL for deployment |
| `POSTGRES_PASSWORD` | Database password when using the supplied Compose stack instead of a native database URL |

The Compose stack constructs its database URL for the `db` container using `POSTGRES_PASSWORD`; it does not use a host `DISPUTEFLOW_DATABASE_URL`. All three backend services receive the shared execution, provider, policy, model, and authentication settings.

Optional settings: `DISPUTEFLOW_OPENAI_BASE_URL` defaults to `https://api.openai.com/v1`; `DISPUTEFLOW_POLICY_DIR` defaults to the bundled policy directory; `DISPUTEFLOW_CORS_ORIGINS` is a JSON array for a dashboard using another origin. With the supplied same-origin `/api` proxy, leave CORS origins as `[]`.

## Configuration template

Replace every placeholder. This example intentionally retains `dry_run` while reading the live environment; it does not authorize real response submission.

```dotenv
DISPUTEFLOW_ENVIRONMENT=production
DISPUTEFLOW_API_KEY=REPLACE_WITH_RANDOM_SERVICE_KEY_AT_LEAST_32_CHARACTERS
DISPUTEFLOW_REVIEWER_API_KEY=REPLACE_WITH_DIFFERENT_RANDOM_REVIEWER_KEY_AT_LEAST_32_CHARACTERS
POSTGRES_PASSWORD=REPLACE_WITH_DATABASE_PASSWORD

DISPUTEFLOW_LLM_PROVIDER=openai
DISPUTEFLOW_OPENAI_API_KEY=REPLACE_WITH_OPENAI_API_KEY
DISPUTEFLOW_OPENAI_MODEL=REPLACE_WITH_YOUR_STRUCTURED_OUTPUT_MODEL

DISPUTEFLOW_PAYPAL_ENVIRONMENT=live
DISPUTEFLOW_PAYPAL_CLIENT_ID=REPLACE_WITH_LIVE_CLIENT_ID
DISPUTEFLOW_PAYPAL_CLIENT_SECRET=REPLACE_WITH_LIVE_CLIENT_SECRET
DISPUTEFLOW_PAYPAL_WEBHOOK_ID=REPLACE_WITH_REGISTERED_LIVE_WEBHOOK_ID
DISPUTEFLOW_WEBHOOK_POLICY_ID=REPLACE_WITH_IMPORTED_REVIEWED_POLICY_ID
DISPUTEFLOW_EXECUTION_MODE=dry_run
DISPUTEFLOW_CORS_ORIGINS=[]
```

For native processes, additionally set a real `DISPUTEFLOW_DATABASE_URL` shared by API and worker. Generate the two service keys separately, for example using Python's `secrets.token_urlsafe(32)`.

## PayPal app and webhook setup

Use a PayPal Business merchant REST app in the selected environment and enable its Customer disputes feature. A partner integration acting for other merchants requires separate partner onboarding; this repository currently handles one merchant per deployment. See PayPal's [account and app setup guide](https://developer.paypal.com/disputes/set-up/).

For automatic claim synchronization, register a publicly reachable HTTPS endpoint:

```text
https://YOUR_BACKEND_HOST/webhooks/paypal
```

Subscribe to `CUSTOMER.DISPUTE.CREATED`, `CUSTOMER.DISPUTE.UPDATED`, and `CUSTOMER.DISPUTE.RESOLVED`. Set the resulting webhook ID in backend configuration. If the backend is exposed exclusively through the supplied dashboard proxy, use `https://YOUR_DASHBOARD_HOST/api/webhooks/paypal` instead. PayPal's [webhook guide](https://developer.paypal.com/api/rest/webhooks/rest/) documents the registered ID and HTTPS listener requirements; its [dispute testing guide](https://developer.paypal.com/disputes/test-go-live) lists the dispute events.

The adapter uses PayPal's postback signature verification. The generic webhook simulator sends mock events which do not support that verification method; exercise an actual sandbox app event for an end-to-end webhook test.

## Dashboard fields

In **Connect API**, enter:

| Dashboard field | Value |
| --- | --- |
| API address | `/api` with the supplied proxy, or the HTTPS URL of your DisputeFlow backend |
| Workspace key | The value configured as `DISPUTEFLOW_API_KEY` |
| Reviewer key | The value configured as `DISPUTEFLOW_REVIEWER_API_KEY`; required for review and execution in production |

Enter PayPal and OpenAI secrets only on the backend. Dashboard keys remain in memory and are cleared on reload.

In **Add dispute → Import from PayPal**, enter the real **PayPal dispute ID** and select the reviewed **Policy document**. Amount, currency, status, and permitted response actions come from the PayPal snapshot. A manually created local case is sufficient for analysis but cannot authorize a real PayPal response.

Import a real policy JSON from **Policy library → Import policy document**, using reviewer credentials. Its fields are `id`, `title`, `version`, `source_url`, `synthetic: false`, and `sections`. Each section has an `id`, `title`, exact `text`, `children`, and optional `keywords`. Use real reviewed clauses applicable to the merchant; changing the demo policy's flag is not a real policy import. The source URL is provenance metadata and is not fetched automatically. Policy IDs identify immutable versions, so use a new ID when changing a policy.

Add supporting evidence through the case's **Add evidence** dialog: evidence type, content, and the provenance verification checkbox. The API contract additionally has an evidence `id` and `source`. Verify the imported PayPal snapshot's provenance as appropriate. Verification attests provenance, not the truth of every statement. Then analyze the current evidence version.

Record **Review decision** with the permitted response action and a review note. The response dialog requires the action's actual payload: notes/evidence for `provide_evidence`, offer type and amount for `make_offer`, or the corresponding claim/message/escalation fields. The API requires a unique `Idempotency-Key`; the dashboard creates one for the explicit request.

## Start the configured services

For the supplied Compose stack, after filling your `.env`:

```sh
docker compose up --build
```

The migration service applies Alembic before API and worker start. The dashboard is on port 8080 and proxies `/api`. Supply HTTPS through your hosting or reverse proxy for an external deployment.

For native processes, from the repository root with your filled `.env` and shared PostgreSQL URL:

```sh
.venv/bin/alembic upgrade head
.venv/bin/disputeflow serve --host 0.0.0.0 --port 8000
```

In another terminal, from the same directory:

```sh
.venv/bin/disputeflow worker
```

`python3 scripts/dev.py` deliberately forces demo extraction and dry-run execution. Use the configured native processes or Compose for real provider integration.

## Conditions for real response submission

For sandbox submission, set both `DISPUTEFLOW_PAYPAL_ENVIRONMENT=sandbox` and `DISPUTEFLOW_EXECUTION_MODE=sandbox` with sandbox credentials. For live submission, set both to `live` with live credentials. Changing execution mode requires restarting both API and worker. A dry run still permits imported case analysis and makes no response write.

The backend additionally checks a current completed analysis, a PayPal-origin case and imported snapshot, a nonsynthetic policy, review when governance requires it, a permitted approved response, a valid action payload, and no unresolved or prior execution attempt. Before the write, the adapter reads PayPal again and checks the snapshot hash and the current action link. If PayPal has changed, refresh/import and reanalyze before approving another response. An absent HATEOAS action link prevents that response. See the [Disputes API](https://developer.paypal.com/api/customer-disputes/v1/) and [provide-evidence contract](https://developer.paypal.com/api/customer-disputes/v1/disputes-provide-evidence).

Automatic submission additionally needs `auto_execute: true` on the imported case and `execute: true` on its run request, unique complete reasoning, verified fact provenance, no extraction warnings, and compatible confidence/amount/currency settings. These controls use `DISPUTEFLOW_AUTO_CONFIDENCE_THRESHOLD`, `DISPUTEFLOW_AUTO_MAX_AMOUNT`, and `DISPUTEFLOW_AUTO_CURRENCY`. Multiple or inconsistent outcomes cannot auto-execute; an explicit reviewer can still choose an allowed response after examining them. Complex offer/message payloads require explicit reviewed submission.

Binary document upload is not implemented in this dashboard/adapter. Notes and supported tracking/refund metadata are supported; claim workflows requiring attached documents need that separate integration. DisputeFlow submits merchant responses; PayPal determines contested outcomes. Live merchants cannot create customer disputes or invoke sandbox-only adjudication endpoints.

The checked-in test report and backend tests use no real provider credentials. Before enabling live response submission, complete sandbox tests with real app credentials, actual dispute events, reviewed policy clauses, your chosen OpenAI model, and the payloads you intend to send. Docker execution was not verified on the current workstation because Docker is not installed; the Compose file was checked statically.
