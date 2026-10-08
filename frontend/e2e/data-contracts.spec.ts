import { expect, test } from '@playwright/test';
import {
  createDemoCases,
  DEMO_CORRECTION,
  DEMO_POLICY,
  clone,
  replayDemoAnalysis,
  sha256,
  verifyDemoAudit,
} from '../src/data/demo';

// These assertions exercise recorded backend semantics and provenance. They do
// not require a running browser, backend, or external account.
test('verified tracking correction retracts the earlier merchant action', async () => {
  const [item] = await createDemoCases();
  expect(item.latest_run?.result?.solver?.status).toBe('unique');
  expect(item.latest_run?.result?.governance.recommended_action).toBe('provide_evidence');
  const changed = clone(item.data);
  changed.evidence.push({ ...DEMO_CORRECTION, id: 'new_carrier_correction' });
  const after = replayDemoAnalysis(changed);
  expect(after.governance.recommended_action).toBe('accept_claim');
  expect(after.solver?.status).toBe('unique');
  expect(after.solver?.models[0].decisions).toEqual(['accept_claim']);
  const fact = after.knowledge_base?.facts.find(
    (value) => value.literal.name === 'tracking_invalid',
  );
  expect(fact?.evidence_ids).toEqual(['new_carrier_correction']);
  expect(
    after.solver?.proof.nodes.some((node) => node.id === 'evidence:new_carrier_correction'),
  ).toBe(true);
  expect(after.solver?.proof.nodes.some((node) => node.id.startsWith('evidence:fixture_'))).toBe(
    false,
  );
  expect(
    after.solver?.proof.edges.some(
      (edge) =>
        edge.source === 'evidence:new_carrier_correction' &&
        edge.target === `fact:${fact?.id}` &&
        edge.relation === 'supports',
    ),
  ).toBe(true);
  expect(after.solver?.program_sha256).toBe(await sha256(after.solver!.program));
});

test('unverified tracking is not promoted into a logical fact', async () => {
  const [item] = await createDemoCases();
  const changed = clone(item.data);
  changed.evidence.push({ ...DEMO_CORRECTION, verified: false });
  const result = replayDemoAnalysis(changed);
  expect(result.governance.recommended_action).toBe('provide_evidence');
  expect(
    result.knowledge_base?.facts.some((fact) => fact.literal.name === 'tracking_invalid'),
  ).toBe(false);
  expect(
    result.knowledge_base?.warnings.some((warning) =>
      warning.includes('Unverified evidence carrier_correction'),
    ),
  ).toBe(true);
});

test('competing extensions and contradictory evidence require manual review', async () => {
  const cases = await createDemoCases();
  const multiple = cases[1].latest_run!.result!;
  expect(multiple.solver?.status).toBe('multiple');
  expect(multiple.solver?.models).toHaveLength(2);
  expect(multiple.governance.recommended_action).toBeNull();
  expect(multiple.governance.requires_human).toBe(true);
  const inconsistent = cases[3].latest_run!.result!;
  expect(inconsistent.solver?.status).toBe('inconsistent');
  expect(inconsistent.solver?.models).toHaveLength(0);
  const delivery = inconsistent.knowledge_base!.facts.filter(
    (fact) => fact.literal.name === 'delivery_verified',
  );
  expect(delivery.map((fact) => fact.literal.negated).sort()).toEqual([false, true]);
  expect(inconsistent.attempts.length).toBeGreaterThan(1);
  expect(inconsistent.governance.requires_human).toBe(true);
});

test('every policy quotation is an exact source substring and every fact references case evidence', async () => {
  const cases = await createDemoCases();
  for (const item of cases) {
    const result = item.latest_run?.result;
    if (!result?.knowledge_base || !result.solver) continue;
    if (!result.retrieval) throw new Error('A completed demo analysis requires retrieved clauses');
    const clauses = new Map(result.retrieval.clauses.map((clause) => [clause.id, clause]));
    for (const source of [...result.knowledge_base.rules, ...result.knowledge_base.priorities]) {
      expect(source.citations.length).toBeGreaterThan(0);
      for (const citation of source.citations)
        expect(clauses.get(citation.clause_id)?.text).toContain(citation.quote);
    }
    for (const clause of result.retrieval.clauses)
      expect(clause.sha256).toBe(await sha256(clause.text));
    for (const fact of result.knowledge_base.facts) {
      expect(fact.evidence_ids.length).toBeGreaterThan(0);
      for (const id of fact.evidence_ids)
        expect(item.data.evidence.some((evidence) => evidence.id === id && evidence.verified)).toBe(
          true,
        );
    }
    expect(result.solver.program_sha256).toBe(await sha256(result.solver.program));
    expect(result.retrieval.synthetic).toBe(true);
    expect(result.governance.requires_human).toBe(true);
  }
  expect(DEMO_POLICY.title).toContain('not PayPal terms');
});

test('audit chains verify and disclose tampering', async () => {
  const cases = await createDemoCases();
  for (const item of cases) expect(await verifyDemoAudit(item)).toBe(true);
  const changed = clone(cases[0]);
  changed.audit.events[0].data.version = 900;
  expect(await verifyDemoAudit(changed)).toBe(false);
  const dryRun = cases.find((item) => item.execution);
  expect(dryRun?.execution?.mode).toBe('dry_run');
  expect(dryRun?.execution?.response?.external_request_sent).toBe(false);
});

test('unsupported policies never receive a fabricated solver recommendation', async () => {
  const [item] = await createDemoCases();
  const result = replayDemoAnalysis({ ...item.data, policy_id: 'reviewed_real_policy' });
  if (!result.retrieval) throw new Error('The failed demo must identify the requested policy');
  expect(result.solver).toBeNull();
  expect(result.governance.recommended_action).toBeNull();
  expect(result.retrieval.policy_id).toBe('reviewed_real_policy');
  expect(result.retrieval.clauses).toEqual([]);
  expect(result.governance.requires_human).toBe(true);
});

async function withFetchMock(handler: typeof fetch, work: () => Promise<void>) {
  const previousFetch = globalThis.fetch;
  const previousWindow = (globalThis as unknown as { window?: unknown }).window;
  Object.assign(globalThis, { window: globalThis });
  globalThis.fetch = handler;
  try {
    await work();
  } finally {
    globalThis.fetch = previousFetch;
    if (previousWindow === undefined) delete (globalThis as unknown as { window?: unknown }).window;
    else Object.assign(globalThis, { window: previousWindow });
  }
}

test('API pagination loads the whole queue and credentials stay out of serializable state', async () => {
  const { DisputeApi } = await import('../src/lib/api');
  const api = new DisputeApi(
    'http://localhost:8000/',
    'synthetic-service-key',
    'synthetic-reviewer-key',
  );
  const calls: string[] = [];
  await withFetchMock(
    (async (input, options) => {
      calls.push(String(input));
      expect((options?.headers as Record<string, string>)['X-API-Key']).toBe(
        'synthetic-service-key',
      );
      const last = String(input).includes('offset=200');
      return new Response(
        JSON.stringify({
          items: last
            ? [{ id: 'final_item' }]
            : Array.from({ length: 200 }, (_, index) => ({ id: `item_${index}` })),
          total: 201,
          offset: last ? 200 : 0,
          limit: 200,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }) as typeof fetch,
    async () => {
      expect(await api.cases()).toHaveLength(201);
    },
  );
  expect(calls).toEqual([
    'http://localhost:8000/v1/disputes?offset=0&limit=200',
    'http://localhost:8000/v1/disputes?offset=200&limit=200',
  ]);
  expect(JSON.stringify(api)).not.toContain('synthetic-service-key');
  expect(JSON.stringify(api)).not.toContain('synthetic-reviewer-key');
});

test('execution uses reviewer authentication and a stable idempotency header', async () => {
  const { DisputeApi } = await import('../src/lib/api');
  const api = new DisputeApi(
    'http://localhost:8000',
    'synthetic-service-key',
    'synthetic-reviewer-key',
  );
  await withFetchMock(
    (async (input, options) => {
      expect(String(input)).toBe('http://localhost:8000/v1/runs/run_42/execute');
      expect((options?.headers as Record<string, string>)['X-API-Key']).toBe(
        'synthetic-reviewer-key',
      );
      expect((options?.headers as Record<string, string>)['Idempotency-Key']).toBe(
        'console:test-42',
      );
      expect(options?.method).toBe('POST');
      expect(JSON.parse(String(options?.body))).toEqual({
        payload: { note: 'Explicit reviewed response.' },
      });
      return new Response(
        JSON.stringify({ id: 'execution_42', status: 'succeeded', mode: 'dry_run' }),
        { status: 200 },
      );
    }) as typeof fetch,
    async () => {
      expect(
        (await api.execute('run_42', { note: 'Explicit reviewed response.' }, 'console:test-42'))
          .mode,
      ).toBe('dry_run');
    },
  );
});

test('API validation failures retain an actionable message and reject the operation', async () => {
  const { DisputeApi, ApiError } = await import('../src/lib/api');
  const api = new DisputeApi('http://localhost:8000', 'synthetic-service-key');
  await withFetchMock(
    (async () =>
      new Response(
        JSON.stringify({ detail: 'Run is stale; analyze the current evidence version' }),
        { status: 409 },
      )) as typeof fetch,
    async () => {
      await expect(api.review('old_run', 'accept_claim', 'Reviewed.')).rejects.toThrow(
        'Run is stale',
      );
      await expect(api.review('old_run', 'accept_claim', 'Reviewed.')).rejects.toBeInstanceOf(
        ApiError,
      );
    },
  );
  expect(() => new DisputeApi('https://example.test?api_key=secret', 'test')).toThrow(
    'without credentials',
  );
});

test('same-origin root-relative API addresses keep the proxy path and reject unsafe URL forms', async () => {
  const { DisputeApi } = await import('../src/lib/api');
  const api = new DisputeApi('/api/', 'synthetic-service-key');
  expect(api.baseUrl).toBe('/api');
  await withFetchMock(
    (async (input) => {
      expect(String(input)).toBe('/api/ready');
      return new Response(
        JSON.stringify({ status: 'ready', execution_mode: 'dry_run', llm_provider: 'demo' }),
        { status: 200 },
      );
    }) as typeof fetch,
    async () => {
      expect((await api.ready()).execution_mode).toBe('dry_run');
    },
  );
  for (const invalid of [
    '//external.example/api',
    '/api?secret=key',
    '/api#secret',
    '/\\external.example/api',
    'https://user:password@example.test/api',
  ]) {
    expect(() => new DisputeApi(invalid, 'test')).toThrow();
  }
});

test('the policy library loads immutable full policy text rather than headings alone', async () => {
  const { DisputeApi } = await import('../src/lib/api');
  const api = new DisputeApi('/api', 'synthetic-service-key');
  const calls: string[] = [];
  await withFetchMock(
    (async (input) => {
      const path = String(input);
      calls.push(path);
      const body =
        path === '/api/v1/policies'
          ? {
              items: [
                {
                  id: DEMO_POLICY.id,
                  title: DEMO_POLICY.title,
                  version: DEMO_POLICY.version,
                  source_url: DEMO_POLICY.source_url,
                  synthetic: true,
                  sha256: 'test-source-hash',
                },
              ],
            }
          : DEMO_POLICY;
      return new Response(JSON.stringify(body), { status: 200 });
    }) as typeof fetch,
    async () => {
      const policies = await api.policies();
      expect(policies[0].document).toEqual(DEMO_POLICY);
      expect(policies[0].sections[1].children[1].text).toBe(
        DEMO_POLICY.sections[1].children[1].text,
      );
      expect(policies[0].sha256).toBe('test-source-hash');
    },
  );
  expect(calls).toEqual(['/api/v1/policies', '/api/v1/policies/demo_policy']);
});
