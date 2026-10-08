import {
  createContext,
  createElement,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type {
  Action,
  AnalysisProgress,
  AuditTrail,
  CaseDisplay,
  CaseInput,
  Connection,
  Evidence,
  ExecutionView,
  Metrics,
  PolicyDocument,
  ReviewView,
  RunView,
  WorkspaceCase,
  WorkspacePolicy,
} from '../types';
import {
  appendAudit,
  canonical,
  clone,
  createDemoCases,
  createDemoPolicies,
  demoMetrics,
  newDemoCase,
  replayDemoAnalysis,
  sha256,
  verifyDemoAudit,
} from '../data/demo';
import { DisputeApi } from './api';
import { normalizeCase } from './cases';

export interface Workspace {
  cases: WorkspaceCase[];
  selectedCase: WorkspaceCase | undefined;
  selectedId: string | null;
  selectCase: (id: string) => void;
  metrics: Metrics;
  connection: Connection;
  loading: boolean;
  busy: boolean;
  error: string | null;
  toast: string | null;
  analysisProgress: AnalysisProgress | null;
  policies: WorkspacePolicy[];
  refresh: () => Promise<void>;
  analyze: (caseId: string) => Promise<RunView>;
  review: (runId: string, action: Action, note: string) => Promise<ReviewView>;
  execute: (runId: string, payload: Record<string, unknown>) => Promise<ExecutionView>;
  addEvidence: (caseId: string, evidence: Evidence) => Promise<void>;
  verifyEvidence: (caseId: string, evidenceId: string, note?: string) => Promise<void>;
  getAudit: (caseId: string) => Promise<AuditTrail>;
  createCase: (input: CaseInput, display?: Partial<CaseDisplay>) => Promise<WorkspaceCase>;
  importPayPal: (externalId: string, policyId?: string) => Promise<WorkspaceCase>;
  importPolicy: (document: PolicyDocument) => Promise<void>;
  connect: (baseUrl: string, key: string, reviewerKey?: string) => Promise<void>;
  disconnect: () => Promise<void>;
  clearToast: () => void;
  clearError: () => void;
}
const WorkspaceContext = createContext<Workspace | null>(null);
const DEMO_CONNECTION: Connection = {
  mode: 'demo',
  baseUrl: '/api',
  hasKey: false,
  hasReviewerKey: false,
  executionMode: 'dry_run',
  llmProvider: 'offline_fixture_replay',
};
const EMPTY_METRICS: Metrics = { cases: {}, runs: {}, executions: {}, webhooks: {} };
const pause = (duration: number) =>
  new Promise<void>((resolve) => window.setTimeout(resolve, duration));

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [cases, setCases] = useState<WorkspaceCase[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [policies, setPolicies] = useState<WorkspacePolicy[]>([]);
  const [connection, setConnection] = useState<Connection>(DEMO_CONNECTION);
  const [metrics, setMetrics] = useState<Metrics>(EMPTY_METRICS);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [analysisProgress, setAnalysisProgress] = useState<AnalysisProgress | null>(null);
  // Credentials stay in memory. No localStorage, cookies, URL, or environment file.
  const client = useRef<DisputeApi | null>(null);
  const caseRef = useRef<WorkspaceCase[]>([]);
  const generation = useRef(0);
  const actionLock = useRef(false);
  const mounted = useRef(true);
  const requestKeys = useRef(new Map<string, string>());

  const commitCases = (items: WorkspaceCase[]) => {
    caseRef.current = items;
    setCases(items);
    if (!client.current) setMetrics(demoMetrics(items));
  };
  const commitCase = (item: WorkspaceCase) => {
    const found = caseRef.current.some((candidate) => candidate.id === item.id);
    commitCases(
      found
        ? caseRef.current.map((candidate) => (candidate.id === item.id ? item : candidate))
        : [item, ...caseRef.current],
    );
  };
  const requireCase = (id: string) => {
    const item = caseRef.current.find((candidate) => candidate.id === id);
    if (!item) throw new Error('This case is unavailable. Refresh the workspace.');
    return item;
  };
  const requireRunCase = (runId: string) => {
    const item = caseRef.current.find((candidate) => candidate.latest_run_id === runId);
    if (
      !item?.latest_run ||
      item.latest_run.status !== 'completed' ||
      item.latest_run.case_version !== item.version
    )
      throw new Error('Analyze the current evidence version before reviewing or executing it.');
    return item;
  };
  async function operation<T>(work: () => Promise<T>): Promise<T> {
    if (actionLock.current) throw new Error('Another operation is still in progress.');
    actionLock.current = true;
    setBusy(true);
    setError(null);
    try {
      return await work();
    } catch (failure) {
      const message =
        failure instanceof Error ? failure.message : 'The operation could not be completed.';
      setError(message);
      throw failure;
    } finally {
      actionLock.current = false;
      if (mounted.current) {
        setBusy(false);
        setAnalysisProgress(null);
      }
    }
  }

  async function initializeDemo() {
    const token = ++generation.current;
    setLoading(true);
    try {
      const [items, documents] = await Promise.all([createDemoCases(), createDemoPolicies()]);
      if (!mounted.current || generation.current !== token) return;
      client.current = null;
      requestKeys.current.clear();
      setConnection(DEMO_CONNECTION);
      commitCases(items);
      setPolicies(documents);
      setSelectedId(items[0]?.id ?? null);
      setError(null);
    } catch {
      setError('The demo requires a modern browser with Web Crypto on localhost or HTTPS.');
    } finally {
      if (mounted.current && generation.current === token) setLoading(false);
    }
  }
  useEffect(() => {
    mounted.current = true;
    void initializeDemo();
    return () => {
      mounted.current = false;
      generation.current += 1;
      client.current = null;
    };
    // Initialization intentionally runs once for each mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 6000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  async function loadDetails(
    api: DisputeApi,
    id: string,
    token = generation.current,
  ): Promise<WorkspaceCase> {
    const [view, audit] = await Promise.all([api.case(id), api.audit(id)]);
    const item = normalizeCase(
      view,
      caseRef.current.find((value) => value.id === id),
    );
    item.audit = audit;
    if (item.latest_run_id) {
      const [review, executions] = await Promise.all([
        api.runReview(item.latest_run_id),
        api.runExecutions(item.latest_run_id),
      ]);
      item.review = review;
      item.execution = executions[0] ?? null;
    }
    if (mounted.current && generation.current === token && client.current === api) commitCase(item);
    return item;
  }
  async function loadWorkspace(api: DisputeApi) {
    const [items, reviews, counts, documents] = await Promise.all([
      api.cases(),
      api.reviews(),
      api.metrics(),
      api.policies(),
    ]);
    const reviewIds = new Set(reviews.map((item) => item.id));
    const normalized = items.map((item) =>
      normalizeCase(
        { ...item, status: reviewIds.has(item.id) ? 'review_required' : item.status },
        caseRef.current.find((previous) => previous.id === item.id),
      ),
    );
    // Lists intentionally omit run results. Fetch actual case details for analysis badges.
    const queue = [...normalized];
    await Promise.all(
      Array.from({ length: Math.min(8, queue.length) }, async () => {
        while (queue.length) {
          const next = queue.shift();
          if (!next) return;
          const detail = await api.case(next.id);
          Object.assign(next, normalizeCase(detail, next));
          if (next.latest_run_id) {
            const [review, executions] = await Promise.all([
              api.runReview(next.latest_run_id),
              api.runExecutions(next.latest_run_id),
            ]);
            next.review = review;
            next.execution = executions[0] ?? null;
          }
        }
      }),
    );
    return { cases: normalized, metrics: counts, policies: documents };
  }

  const connect: Workspace['connect'] = (baseUrl, key, reviewerKey = '') =>
    operation(async () => {
      const api = new DisputeApi(baseUrl, key, reviewerKey);
      const token = generation.current;
      const [ready, data] = await Promise.all([api.ready(), loadWorkspace(api)]);
      if (!mounted.current || generation.current !== token) return;
      generation.current += 1;
      client.current = api;
      requestKeys.current.clear();
      setConnection({
        mode: 'api',
        baseUrl: api.baseUrl,
        hasKey: true,
        hasReviewerKey: Boolean(reviewerKey.trim()),
        executionMode: ready.execution_mode,
        llmProvider: ready.llm_provider,
      });
      commitCases(data.cases);
      setMetrics(data.metrics);
      setPolicies(data.policies);
      const first = data.cases[0]?.id ?? null;
      setSelectedId(first);
      setToast('API connected. Credentials are held in memory for this session.');
      if (first) await loadDetails(api, first);
    });
  const disconnect: Workspace['disconnect'] = () =>
    operation(async () => {
      client.current = null;
      await initializeDemo();
      setToast('Offline demonstration restored.');
    });
  const refresh: Workspace['refresh'] = () =>
    operation(async () => {
      const api = client.current;
      if (!api) {
        setMetrics(demoMetrics(caseRef.current));
        setToast('Demo workspace is up to date.');
        return;
      }
      const token = generation.current;
      const data = await loadWorkspace(api);
      if (generation.current !== token) return;
      commitCases(data.cases);
      setMetrics(data.metrics);
      setPolicies(data.policies);
      const id =
        selectedId && data.cases.some((item) => item.id === selectedId)
          ? selectedId
          : (data.cases[0]?.id ?? null);
      setSelectedId(id);
      if (id) await loadDetails(api, id, token);
      setToast('Workspace refreshed.');
    });
  const selectCase = (id: string) => {
    setSelectedId(id);
    setError(null);
    const api = client.current;
    if (!api) return;
    const token = generation.current;
    void loadDetails(api, id, token).catch((failure) => {
      if (generation.current === token)
        setError(failure instanceof Error ? failure.message : 'Cannot load this case.');
    });
  };
  const analyze: Workspace['analyze'] = (caseId) =>
    operation(async () => {
      const original = requireCase(caseId);
      if (['executing', 'execution_uncertain', 'resolved'].includes(original.status))
        throw new Error('This case cannot be changed until the current execution is resolved.');
      const api = client.current;
      if (api) {
        const token = generation.current;
        let run = await api.analyze(caseId);
        commitCase({
          ...original,
          status: 'analyzing',
          latest_run_id: run.id,
          latest_run: run,
          review: null,
          execution: null,
        });
        const start = Date.now();
        while (['queued', 'running'].includes(run.status)) {
          if (generation.current !== token || !mounted.current)
            throw new Error('The API session changed while the analysis was running.');
          setAnalysisProgress({
            caseId,
            stage:
              run.status === 'queued' ? 'Waiting for the analysis worker' : 'Analysis in progress',
            percent:
              run.status === 'queued'
                ? 10
                : Math.min(88, 30 + Math.floor((Date.now() - start) / 3000)),
          });
          if (Date.now() - start > 240000)
            throw new Error(
              'The worker has not finished yet. The run is saved; refresh to check its status.',
            );
          await pause(1200);
          run = await api.run(run.id);
        }
        await loadDetails(api, caseId, token);
        setMetrics(await api.metrics());
        if (run.status !== 'completed')
          throw new Error(run.error || `The analysis ended with status: ${run.status}.`);
        setToast('Analysis complete. Current evidence version is ready for review.');
        return run;
      }
      const item = clone(original);
      const runId = `demo_run_${crypto.randomUUID()}`;
      const started = new Date().toISOString();
      item.status = 'analyzing';
      item.review = null;
      item.execution = null;
      item.latest_run_id = runId;
      item.latest_run = {
        id: runId,
        case_id: caseId,
        case_version: item.version,
        input_snapshot: clone(item.data),
        status: 'running',
        execute_requested: false,
        result: null,
        error: null,
        created_at: started,
        finished_at: null,
      };
      await appendAudit(item, 'analysis_enqueued', {
        run_id: runId,
        case_version: item.version,
        fixture_replay: true,
      });
      commitCase(clone(item));
      const stages = [
        'Load the demonstration case',
        'Retrieve the synthetic policy',
        'Match the verified evidence',
        'Replay recorded stable models',
        'Apply demonstration governance',
      ];
      for (const [index, stage] of stages.entries()) {
        setAnalysisProgress({ caseId, stage, percent: 12 + index * 18 });
        await pause(320);
      }
      const result = replayDemoAnalysis(item.data);
      item.latest_run.result = result;
      item.latest_run.status = 'completed';
      item.latest_run.finished_at = new Date().toISOString();
      item.status = 'review_required';
      item.updated_at = item.latest_run.finished_at;
      await appendAudit(item, 'analysis_completed', {
        run_id: runId,
        case_version: item.version,
        solver_status: result.solver?.status ?? 'not_replayed',
        recommended_action: result.governance.recommended_action,
        fixture_replay: true,
      });
      commitCase(item);
      setToast('Demo analysis complete. Review the grounded recommendation.');
      return item.latest_run;
    });
  const review: Workspace['review'] = (runId, action, note) =>
    operation(async () => {
      if (note.trim().length < 3)
        throw new Error('Add a review note of at least three characters.');
      const original = requireRunCase(runId);
      if (action !== 'no_action' && !original.data.allowed_actions.includes(action))
        throw new Error('This action is not allowed for this case.');
      if (original.review)
        throw new Error(
          'This run has already been reviewed. Create a new analysis for another decision.',
        );
      const api = client.current;
      if (api) {
        const saved = await api.review(runId, action, note.trim());
        const item = await loadDetails(api, original.id);
        commitCase({ ...item, review: saved });
        setMetrics(await api.metrics());
        setToast(
          action === 'no_action'
            ? 'Case held. Your review was saved.'
            : 'Decision reviewed and approved.',
        );
        return saved;
      }
      const item = clone(original);
      const saved: ReviewView = {
        id: `demo_review_${crypto.randomUUID()}`,
        run_id: runId,
        action,
        note: note.trim(),
        actor: 'demo_operator',
        created_at: new Date().toISOString(),
      };
      item.review = saved;
      item.status = action === 'no_action' ? 'held' : 'reviewed';
      item.updated_at = saved.created_at;
      await appendAudit(item, 'human_review', { run_id: runId, action, note: saved.note });
      commitCase(item);
      setToast(
        action === 'no_action'
          ? 'Case held. Review recorded in the demo audit.'
          : 'Decision approved. Ready for a demonstration dry run.',
      );
      return saved;
    });
  const execute: Workspace['execute'] = (runId, payload) =>
    operation(async () => {
      const original = requireRunCase(runId);
      if (!original.review || original.review.action === 'no_action')
        throw new Error('Approve an executable action before submitting a response.');
      if (original.execution)
        throw new Error(
          'This run already has an execution attempt. Inspect its journal before retrying.',
        );
      const api = client.current;
      if (api) {
        const signature = `${runId}:${canonical(payload)}`;
        const key = requestKeys.current.get(signature) ?? `console:${crypto.randomUUID()}`;
        requestKeys.current.set(signature, key);
        const saved = await api.execute(runId, payload, key);
        const item = await loadDetails(api, original.id);
        commitCase({ ...item, execution: saved });
        setMetrics(await api.metrics());
        setToast(
          saved.mode === 'dry_run'
            ? 'Dry run recorded. No external PayPal request was sent.'
            : `Execution recorded with status: ${saved.status}.`,
        );
        return saved;
      }
      const item = clone(original);
      if (!Object.keys(payload).length)
        throw new Error('Review an explicit response payload before recording a dry run.');
      const created = new Date().toISOString();
      const saved: ExecutionView = {
        id: `demo_execution_${crypto.randomUUID()}`,
        run_id: runId,
        idempotency_key: `demo:${runId}`,
        request_hash: await sha256(canonical({ run_id: runId, payload, mode: 'dry_run' })),
        mode: 'dry_run',
        action: original.review.action,
        payload: clone(payload),
        status: 'succeeded',
        response: { dry_run: true, synthetic: true, external_request_sent: false },
        error: null,
        created_at: created,
        finished_at: created,
      };
      item.execution = saved;
      item.status = 'executed';
      item.updated_at = created;
      await appendAudit(item, 'execution_succeeded', {
        run_id: runId,
        execution_id: saved.id,
        mode: 'dry_run',
        action: saved.action,
        external_request_sent: false,
      });
      commitCase(item);
      setToast('Dry run recorded. No external PayPal request was sent.');
      return saved;
    });
  const addEvidence: Workspace['addEvidence'] = (caseId, evidence) =>
    operation(async () => {
      if (!evidence.id.trim() || !evidence.content.trim())
        throw new Error('Evidence requires an identifier and content.');
      const original = requireCase(caseId);
      const api = client.current;
      if (api) {
        await api.addEvidence(caseId, evidence);
        await loadDetails(api, caseId);
        setMetrics(await api.metrics());
      } else {
        if (['executing', 'execution_uncertain', 'resolved'].includes(original.status))
          throw new Error('Evidence is locked until this case is resolved.');
        const item = clone(original);
        const index = item.data.evidence.findIndex((candidate) => candidate.id === evidence.id);
        if (index < 0) item.data.evidence.push(clone(evidence));
        else item.data.evidence[index] = clone(evidence);
        if (item.data.evidence.length > 100)
          throw new Error('A case may contain at most 100 evidence records.');
        item.version += 1;
        item.status = 'open';
        item.latest_run_id = null;
        item.latest_run = null;
        item.review = null;
        item.execution = null;
        item.updated_at = new Date().toISOString();
        await appendAudit(item, 'evidence_updated', {
          version: item.version,
          evidence_ids: [evidence.id],
        });
        commitCase(item);
      }
      setToast('Evidence saved. Analyze the new version before reviewing it.');
    });
  const verifyEvidence: Workspace['verifyEvidence'] = (
    caseId,
    evidenceId,
    note = 'Evidence reviewed and verified by the operator.',
  ) =>
    operation(async () => {
      if (note.trim().length < 3)
        throw new Error('Add a verification note of at least three characters.');
      const original = requireCase(caseId);
      const api = client.current;
      if (api) {
        await api.verifyEvidence(caseId, evidenceId, note.trim());
        await loadDetails(api, caseId);
        setMetrics(await api.metrics());
      } else {
        const item = clone(original);
        const evidence = item.data.evidence.find((candidate) => candidate.id === evidenceId);
        if (!evidence) throw new Error('This evidence record is unavailable.');
        evidence.verified = true;
        item.version += 1;
        item.status = 'open';
        item.latest_run_id = null;
        item.latest_run = null;
        item.review = null;
        item.execution = null;
        item.updated_at = new Date().toISOString();
        await appendAudit(item, 'evidence_verification', {
          version: item.version,
          evidence_id: evidenceId,
          verified: true,
          note: note.trim(),
        });
        commitCase(item);
      }
      setToast('Evidence verified. Analyze the updated version to refresh the decision.');
    });
  const getAudit: Workspace['getAudit'] = async (caseId) => {
    const api = client.current;
    if (api) {
      const audit = await api.audit(caseId);
      const previous = caseRef.current.find((item) => item.id === caseId);
      if (previous) commitCase({ ...previous, audit });
      return audit;
    }
    const item = requireCase(caseId);
    return { ...clone(item.audit), verified: await verifyDemoAudit(item) };
  };
  const createCase: Workspace['createCase'] = (input, display) =>
    operation(async () => {
      const api = client.current;
      let item: WorkspaceCase;
      if (api) {
        item = normalizeCase(await api.createCase(input));
        if (display) item.display = { ...item.display, ...display };
        commitCase(item);
        setMetrics(await api.metrics());
      } else {
        item = newDemoCase(input, caseRef.current.length + 1, display);
        await appendAudit(item, 'case_created', {
          version: 1,
          synthetic: true,
          external_id: input.external_id,
        });
        commitCase(item);
      }
      setSelectedId(item.id);
      setToast(
        api
          ? 'Case created. Add verified evidence and run an analysis.'
          : 'Synthetic case created. Ready for demonstration analysis.',
      );
      return item;
    });
  const importPayPal: Workspace['importPayPal'] = (externalId, policyId = 'demo_policy') =>
    operation(async () => {
      const api = client.current;
      if (!api) throw new Error('Connect the API to import an actual PayPal dispute.');
      if (!externalId.trim()) throw new Error('Enter the PayPal dispute identifier.');
      const item = normalizeCase(await api.importPayPal(externalId.trim(), policyId));
      commitCase(item);
      setSelectedId(item.id);
      setMetrics(await api.metrics());
      setToast('PayPal dispute imported. Review its evidence before analysis.');
      return item;
    });
  const importPolicy: Workspace['importPolicy'] = (document) =>
    operation(async () => {
      const api = client.current;
      if (api) {
        await api.importPolicy(document);
        setPolicies(await api.policies());
      } else {
        if (
          !document.id ||
          !document.title ||
          !document.version ||
          !document.source_url ||
          !document.sections?.length
        )
          throw new Error(
            'A policy requires an ID, title, version, source, and at least one section.',
          );
        if (policies.some((policy) => policy.id === document.id))
          throw new Error('Policy IDs are immutable. Use a new ID for each revision.');
        setPolicies((previous) => [
          ...previous,
          { ...clone(document), sha256: '', document: clone(document) },
        ]);
        const hash = await sha256(canonical(document));
        setPolicies((previous) =>
          previous.map((policy) =>
            policy.id === document.id ? { ...policy, sha256: hash } : policy,
          ),
        );
      }
      setToast('Policy imported. Each revision keeps its own immutable identifier.');
    });
  const selectedCase = useMemo(
    () => cases.find((item) => item.id === selectedId),
    [cases, selectedId],
  );
  const value: Workspace = {
    cases,
    selectedCase,
    selectedId,
    selectCase,
    metrics,
    connection,
    loading,
    busy,
    error,
    toast,
    analysisProgress,
    policies,
    refresh,
    analyze,
    review,
    execute,
    addEvidence,
    verifyEvidence,
    getAudit,
    createCase,
    importPayPal,
    importPolicy,
    connect,
    disconnect,
    clearToast: () => setToast(null),
    clearError: () => setError(null),
  };
  return createElement(WorkspaceContext.Provider, { value }, children);
}
export function useWorkspace(): Workspace {
  const workspace = useContext(WorkspaceContext);
  if (!workspace) throw new Error('useWorkspace must be used within WorkspaceProvider.');
  return workspace;
}
