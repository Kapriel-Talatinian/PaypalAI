import type {
  AuditTrail,
  CaseInput,
  CasePage,
  CaseView,
  Evidence,
  ExecutionView,
  Metrics,
  PolicyDocument,
  ReviewView,
  RunView,
  Action,
  WorkspacePolicy,
  ExecutionMode,
} from '../types';

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

export class DisputeApi {
  readonly baseUrl: string;
  readonly #key: string;
  readonly #reviewerKey: string;
  constructor(baseUrl: string, key: string, reviewerKey = '') {
    const address = baseUrl.trim();
    const relative = address.startsWith('/');
    if (address.startsWith('//') || address.includes('\\'))
      throw new Error(
        'Use a same-origin root-relative API path or an HTTP or HTTPS API URL without credentials, a query, or a fragment.',
      );
    let parsed: URL;
    try {
      parsed = relative ? new URL(address, 'http://same-origin.invalid') : new URL(address);
    } catch {
      throw new Error('Enter a valid API address, such as /api or http://localhost:8000.');
    }
    if (
      !['http:', 'https:'].includes(parsed.protocol) ||
      parsed.username ||
      parsed.password ||
      parsed.search ||
      parsed.hash
    )
      throw new Error('Use an HTTP or HTTPS API URL without credentials, a query, or a fragment.');
    if (!key.trim()) throw new Error('An API key is required.');
    this.baseUrl = relative
      ? parsed.pathname.replace(/\/+$/, '')
      : parsed.toString().replace(/\/$/, '');
    this.#key = key.trim();
    this.#reviewerKey = reviewerKey.trim();
  }
  async request<T>(
    path: string,
    options: {
      method?: 'GET' | 'POST';
      body?: unknown;
      reviewer?: boolean;
      idempotencyKey?: string;
      signal?: AbortSignal;
    } = {},
  ): Promise<T> {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 20000);
    const abort = () => controller.abort();
    options.signal?.addEventListener('abort', abort, { once: true });
    const headers: Record<string, string> = {
      'X-API-Key': options.reviewer && this.#reviewerKey ? this.#reviewerKey : this.#key,
    };
    if (options.body !== undefined) headers['Content-Type'] = 'application/json';
    if (options.idempotencyKey) headers['Idempotency-Key'] = options.idempotencyKey;
    try {
      const response = await fetch(`${this.baseUrl}${path}`, {
        method: options.method ?? 'GET',
        headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        signal: controller.signal,
        credentials: 'omit',
      });
      const data: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        const detail =
          data && typeof data === 'object' && 'detail' in data
            ? (data as { detail: unknown }).detail
            : undefined;
        const message =
          typeof detail === 'string'
            ? detail.slice(0, 1500)
            : Array.isArray(detail)
              ? 'The API rejected these fields. Check the form values and retry.'
              : `The API returned HTTP ${response.status}.`;
        throw new ApiError(response.status, message);
      }
      return data as T;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      if (error instanceof Error && error.name === 'AbortError')
        throw new Error('The API request timed out or was cancelled.');
      throw new Error(
        'Cannot reach the API. Check the URL, server availability, and CORS configuration.',
      );
    } finally {
      window.clearTimeout(timer);
      options.signal?.removeEventListener('abort', abort);
    }
  }
  ready() {
    return this.request<{ status: string; execution_mode: ExecutionMode; llm_provider: string }>(
      '/ready',
    );
  }
  async pages(path: '/v1/disputes' | '/v1/reviews'): Promise<CaseView[]> {
    const items: CaseView[] = [];
    for (let offset = 0; ; offset += 200) {
      const page = await this.request<CasePage>(`${path}?offset=${offset}&limit=200`);
      if (!Array.isArray(page?.items)) throw new Error('The API returned an invalid case list.');
      items.push(...page.items);
      if (items.length >= page.total || page.items.length === 0) return items;
      if (offset >= 100000) throw new Error('The workspace exceeds the interactive case limit.');
    }
  }
  cases() {
    return this.pages('/v1/disputes');
  }
  reviews() {
    return this.pages('/v1/reviews');
  }
  case(id: string) {
    return this.request<CaseView>(`/v1/disputes/${encodeURIComponent(id)}`);
  }
  createCase(data: CaseInput) {
    return this.request<CaseView>('/v1/disputes', { method: 'POST', body: data });
  }
  run(id: string) {
    return this.request<RunView>(`/v1/runs/${encodeURIComponent(id)}`);
  }
  runReview(id: string) {
    return this.request<ReviewView | null>(`/v1/runs/${encodeURIComponent(id)}/review`);
  }
  runExecutions(id: string) {
    return this.request<ExecutionView[]>(`/v1/runs/${encodeURIComponent(id)}/executions`);
  }
  analyze(id: string) {
    return this.request<RunView>(`/v1/disputes/${encodeURIComponent(id)}/runs`, {
      method: 'POST',
      body: { execute: false },
    });
  }
  review(id: string, action: Action, note: string) {
    return this.request<ReviewView>(`/v1/runs/${encodeURIComponent(id)}/review`, {
      method: 'POST',
      body: { action, note },
      reviewer: true,
    });
  }
  execute(id: string, payload: Record<string, unknown>, idempotencyKey: string) {
    return this.request<ExecutionView>(`/v1/runs/${encodeURIComponent(id)}/execute`, {
      method: 'POST',
      body: { payload },
      reviewer: true,
      idempotencyKey,
    });
  }
  addEvidence(id: string, evidence: Evidence) {
    return this.request<CaseView>(`/v1/disputes/${encodeURIComponent(id)}/evidence`, {
      method: 'POST',
      body: { evidence: [evidence] },
    });
  }
  verifyEvidence(id: string, evidenceId: string, note: string) {
    return this.request<CaseView>(
      `/v1/disputes/${encodeURIComponent(id)}/evidence/${encodeURIComponent(evidenceId)}/verify`,
      { method: 'POST', body: { verified: true, note }, reviewer: true },
    );
  }
  audit(id: string) {
    return this.request<AuditTrail>(`/v1/disputes/${encodeURIComponent(id)}/audit`);
  }
  metrics() {
    return this.request<Metrics>('/v1/metrics');
  }
  policy(id: string) {
    return this.request<PolicyDocument>(`/v1/policies/${encodeURIComponent(id)}`);
  }
  async policies() {
    const response = await this.request<{ items: Omit<WorkspacePolicy, 'sections'>[] }>(
      '/v1/policies',
    );
    return Promise.all(
      response.items.map(async (item): Promise<WorkspacePolicy> => {
        const document = await this.policy(item.id);
        return { ...item, sections: document.sections, document };
      }),
    );
  }
  importPolicy(document: PolicyDocument) {
    return this.request<PolicyDocument>('/v1/policies', {
      method: 'POST',
      body: document,
      reviewer: true,
    });
  }
  importPayPal(externalId: string, policyId: string) {
    return this.request<CaseView>(`/v1/paypal/disputes/${encodeURIComponent(externalId)}/import`, {
      method: 'POST',
      body: { policy_id: policyId, auto_execute: false },
    });
  }
}
