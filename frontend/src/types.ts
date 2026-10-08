import type { PayPalDisputeMetadata } from './paypal-types';

export type Action =
  'accept_claim' | 'provide_evidence' | 'make_offer' | 'escalate' | 'send_message' | 'no_action';
export type ExecutionMode = 'dry_run' | 'sandbox' | 'live';
export type SolverStatus = 'unique' | 'multiple' | 'inconsistent' | 'truncated' | 'timeout';
export interface Evidence {
  id: string;
  kind: string;
  content: string;
  verified: boolean;
  source: string;
}
export interface CaseInput {
  external_id: string | null;
  reason: string;
  amount: string | number;
  currency: string;
  summary: string;
  evidence: Evidence[];
  policy_id: string;
  auto_execute: boolean;
  allowed_actions: Action[];
  paypal?: PayPalDisputeMetadata | null;
}
export interface Literal {
  name: string;
  negated: boolean;
}
export interface Fact {
  id: string;
  literal: Literal;
  evidence_ids: string[];
  confidence: number;
}
export interface Citation {
  clause_id: string;
  quote: string;
}
export interface Rule {
  id: string;
  head: Literal;
  body: Literal[];
  unless: Literal[];
  kind: 'strict' | 'defeasible' | 'defeater';
  citations: Citation[];
}
export interface Priority {
  higher: string;
  lower: string;
  citations: Citation[];
}
export interface KnowledgeBase {
  facts: Fact[];
  rules: Rule[];
  priorities: Priority[];
  confidence: number;
  warnings: string[];
}
export interface Clause {
  id: string;
  section_path: string[];
  title: string;
  text: string;
  source_url: string;
  version: string;
  sha256: string;
}
export interface Retrieval {
  policy_id: string;
  policy_version: string;
  synthetic: boolean;
  clauses: Clause[];
  trace: Array<RetrievalTraceStep | { status: 'offline_fixture_unavailable' }>;
  authoritative_vocabulary?: string[] | null;
}
export interface RetrievalTraceStep {
  contract_version?: '1.0';
  path: string[];
  offered: string[];
  selected: string[];
  selector: 'deterministic_demo' | 'llm';
  mode?: 'deterministic' | 'probabilistic';
  duration_ms?: number;
  input_sha256?: string | null;
  output_sha256?: string | null;
}
export interface StableModel {
  id: string;
  literals: Literal[];
  applied_rules: string[];
  defeated_rules: string[];
  decisions: Action[];
}
export interface ProofNode {
  id: string;
  kind: string;
  label: string;
  data: Record<string, unknown>;
}
export interface ProofEdge {
  source: string;
  target: string;
  relation: string;
}
export interface ProofGraph {
  nodes: ProofNode[];
  edges: ProofEdge[];
}
export interface SolverResult {
  status: SolverStatus;
  models: StableModel[];
  enumeration_complete: boolean;
  program: string;
  program_sha256: string;
  skeptical: Literal[];
  credulous: Literal[];
  proof: ProofGraph;
  diagnostics: string[];
  diagnostic_details?: SolverDiagnostic[];
}
export interface SolverDiagnostic {
  code: string;
  severity: 'error' | 'warning' | 'info';
  message: string;
  fact_ids: string[];
  rule_ids: string[];
  literals: string[];
  suggestions: string[];
}
export interface Governance {
  recommended_action: Action | null;
  confidence: number;
  requires_human: boolean;
  reasons: string[];
  components: Record<string, number>;
}
export interface AnalysisResult {
  contract_version?: '1.0';
  retrieval: Retrieval | null;
  knowledge_base: KnowledgeBase | null;
  solver: SolverResult | null;
  governance: Governance;
  attempts: AnalysisAttempt[];
  agents: string[];
  stage_trace?: AnalysisStep[];
}
export interface AnalysisAttempt {
  contract_version?: '1.0';
  attempt: number;
  status: SolverStatus | 'invalid_extraction' | 'component_failed';
  knowledge_base?: KnowledgeBase | null;
  program_sha256?: string | null;
  solver?: SolverResult | null;
  diagnostics: string[];
  decision?: 'return' | 'repair' | 'reject';
}
export interface AnalysisStep {
  contract_version: '1.0';
  component: 'policy_retrieval' | 'extraction' | 'verification' | 'asp_reasoning' | 'governance';
  mode: 'deterministic' | 'probabilistic';
  attempt: number;
  status: 'succeeded' | 'rejected' | 'failed';
  decision: string;
  started_at: string;
  finished_at: string;
  duration_ms: number;
  input_sha256: string;
  output_sha256: string | null;
  error_code: string | null;
  diagnostics: string[];
}
export interface RunView {
  id: string;
  case_id: string;
  case_version: number;
  input_snapshot: CaseInput;
  status: string;
  execute_requested: boolean;
  result: AnalysisResult | null;
  error: string | null;
  created_at: string;
  finished_at: string | null;
}
export interface CaseView {
  id: string;
  external_id: string | null;
  origin: string;
  data: CaseInput;
  version: number;
  status: string;
  latest_run_id: string | null;
  created_at: string;
  updated_at: string;
  latest_run?: RunView | null;
}
export interface CasePage {
  items: CaseView[];
  total: number;
  offset: number;
  limit: number;
}
export interface ReviewView {
  id: string;
  run_id: string;
  action: Action;
  note: string;
  actor: string;
  created_at: string;
}
export interface ExecutionView {
  id: string;
  run_id: string;
  idempotency_key: string;
  request_hash: string;
  mode: ExecutionMode;
  action: Action;
  payload: Record<string, unknown>;
  status: string;
  response: Record<string, unknown> | null;
  error: string | null;
  created_at: string;
  finished_at: string | null;
}
export interface AuditEvent {
  case_id: string;
  sequence: number;
  kind: string;
  actor: string;
  data: Record<string, unknown>;
  timestamp: string;
  previous_hash: string;
  hash: string;
}
export interface AuditTrail {
  events: AuditEvent[];
  head: string;
  verified: boolean;
}
export type AuditResponse = AuditTrail;
export interface PolicySection {
  id: string;
  title: string;
  text: string;
  children: PolicySection[];
  keywords: string[];
  has_text?: boolean;
}
export interface PolicyDocument {
  id: string;
  title: string;
  version: string;
  source_url: string;
  synthetic: boolean;
  sections: PolicySection[];
  authoritative_vocabulary?: string[] | null;
}
export interface WorkspacePolicy {
  id: string;
  title: string;
  version: string;
  source_url: string;
  synthetic: boolean;
  sha256: string;
  sections: PolicySection[];
  document?: PolicyDocument;
}
export interface CaseDisplay {
  customer: string;
  email: string;
  initials: string;
  product: string;
  orderId: string;
  category: string;
  channel: string;
  dueAt: string | null;
  previousAction?: Action;
  scenario: string;
}
export interface WorkspaceCase extends CaseView {
  display: CaseDisplay;
  audit: AuditTrail;
  review: ReviewView | null;
  execution: ExecutionView | null;
}
export interface Metrics {
  cases: Record<string, number>;
  runs: Record<string, number>;
  executions: Record<string, number>;
  webhooks: Record<string, number>;
}
export interface Connection {
  mode: 'demo' | 'api';
  baseUrl: string;
  hasKey: boolean;
  hasReviewerKey: boolean;
  executionMode: ExecutionMode;
  llmProvider: string;
}
export interface AnalysisProgress {
  caseId: string;
  stage: string;
  percent: number;
}
