import { useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  Check,
  CheckCheck,
  ChevronDown,
  CircleCheck,
  Copy,
  Download,
  FileCheck2,
  FileText,
  GitBranch,
  Play,
  Plus,
  ShieldCheck,
} from 'lucide-react';
import { useWorkspace } from '../lib/store';
import type { WorkspaceCase } from '../types';
import { ACTION_LABELS, caseCode, date, exportFile, money, shortHash } from '../lib/format';
import { StatusBadge } from './CaseGrid';
import ProofGraph from './ProofGraph';
import AuditTimeline from './AuditTimeline';
import { EvidenceDialog, ExecuteDialog, ReviewDialog } from './Dialogs';

const safe = (promise: Promise<unknown>) => {
  void promise.catch(() => undefined);
};

export default function CaseDetail({ item, onBack }: { item: WorkspaceCase; onBack: () => void }) {
  const workspace = useWorkspace();
  const [tab, setTab] = useState('overview');
  const [dialog, setDialog] = useState<'evidence' | 'review' | 'execute' | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const run = item.latest_run;
  const result = run?.result;
  const solver = result?.solver;
  const action = item.review?.action ?? result?.governance.recommended_action;
  const verified = item.data.evidence.filter((e) => e.verified).length;
  const progress =
    workspace.analysisProgress?.caseId === item.id ? workspace.analysisProgress : null;
  const current = run?.case_version === item.version && run?.status === 'completed';
  const canReview =
    current &&
    !item.review &&
    !['executing', 'execution_uncertain', 'executed', 'resolved'].includes(item.status);
  const canExecute =
    current &&
    action &&
    action !== 'no_action' &&
    !item.execution &&
    (item.review || !result?.governance.requires_human);
  const executed = item.execution?.status === 'succeeded';
  const simulated =
    workspace.connection.mode === 'demo' || workspace.connection.executionMode === 'dry_run';
  const unique = solver?.status === 'unique' && solver.enumeration_complete;
  const inconsistent = solver?.status === 'inconsistent';

  const evidenceList = (
    <div className="evidence-list">
      {item.data.evidence.map((evidence, index) => (
        <article className="evidence-card" key={evidence.id}>
          <div className="evidence-card-top">
            <span className="document-icon">
              <FileText size={19} />
            </span>
            <div>
              <h3>
                {evidence.kind === 'tracking'
                  ? 'Delivery record'
                  : evidence.kind === 'inspection'
                    ? 'Product inspection'
                    : evidence.kind === 'paypal'
                      ? 'PayPal case record'
                      : 'Customer statement'}
                <span className="document-number">{String(index + 1).padStart(2, '0')}</span>
              </h3>
              <p>
                {evidence.source === 'synthetic_fixture'
                  ? 'Demo evidence'
                  : evidence.source.replaceAll('_', ' ')}{' '}
                · {evidence.kind}
              </p>
            </div>
            <span className={`verification ${evidence.verified ? 'verified' : ''}`}>
              {evidence.verified ? (
                <>
                  <ShieldCheck size={12} /> Verified source
                </>
              ) : (
                'Unverified source'
              )}
            </span>
          </div>
          <p className="evidence-content">
            {expanded === evidence.id
              ? evidence.content
              : evidence.content
                  .replace(/FACT:-?[a-z0-9_]+/g, '')
                  .trim()
                  .slice(0, 290)}
            {expanded !== evidence.id && evidence.content.length > 290 ? '…' : ''}
          </p>
          <div className="evidence-card-footer">
            <button
              className="text-button"
              onClick={() => setExpanded(expanded === evidence.id ? null : evidence.id)}
            >
              {expanded === evidence.id ? 'Show less' : 'View source'}
              <ChevronDown size={12} />
            </button>
            {!evidence.verified && (
              <button
                className="text-button"
                disabled={workspace.busy}
                onClick={() =>
                  safe(
                    workspace.verifyEvidence(
                      item.id,
                      evidence.id,
                      'Verified the provenance of the supplied evidence.',
                    ),
                  )
                }
              >
                Verify source
                <Check size={13} />
              </button>
            )}
          </div>
        </article>
      ))}
    </div>
  );

  return (
    <div className="case-detail">
      <button className="back-link" onClick={onBack}>
        <ArrowLeft size={14} />
        Back to disputes
      </button>
      <header className="case-detail-header">
        <div>
          <div className="case-kicker">
            <span className="mono">{caseCode(item)}</span>
            <StatusBadge status={item.status} executionMode={item.execution?.mode} />
          </div>
          <h1>{item.display.customer}</h1>
          <p>
            {item.display.category} <span>·</span> {item.display.product}
          </p>
        </div>
        <button
          className="button secondary"
          onClick={() => setDialog('evidence')}
          disabled={workspace.busy || ['executing', 'execution_uncertain'].includes(item.status)}
        >
          <Plus size={14} /> Add evidence
        </button>
      </header>
      <div className="case-metadata-strip">
        <div>
          <span>Disputed amount</span>
          <strong>{money(item.data.amount, item.data.currency)}</strong>
        </div>
        <div>
          <span>Response due</span>
          <strong>
            {item.display.dueAt
              ? date(item.display.dueAt, { month: 'short', day: 'numeric', year: 'numeric' })
              : 'Not provided'}
          </strong>
        </div>
      </div>
      <details className="case-record-details">
        <summary>
          Case details <ChevronDown size={14} />
        </summary>
        <div className="case-record-content">
          <dl>
            <div>
              <dt>Evidence version</dt>
              <dd>Version {item.version}</dd>
            </div>
            <div>
              <dt>Order reference</dt>
              <dd className="mono">{item.display.orderId}</dd>
            </div>
            <div>
              <dt>Opened</dt>
              <dd>{date(item.created_at, { month: 'short', day: 'numeric', year: 'numeric' })}</dd>
            </div>
            <div>
              <dt>Case origin</dt>
              <dd>{item.display.channel}</dd>
            </div>
          </dl>
          <button
            className="button secondary small"
            onClick={() =>
              exportFile(
                `${caseCode(item)}-case.json`,
                JSON.stringify({ case: item, run, audit: item.audit }, null, 2),
              )
            }
          >
            <Download size={14} /> Export case
          </button>
        </div>
      </details>
      <nav className="detail-tabs" aria-label="Case sections">
        {[
          ['overview', 'Overview'],
          ['evidence', `Evidence (${item.data.evidence.length})`],
          ['reasoning', 'Reasoning graph'],
          ['audit', 'Audit trail'],
        ].map(([id, label]) => (
          <button key={id} className={tab === id ? 'active' : ''} onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
      </nav>
      {progress && (
        <div className="analysis-progress" role="status">
          <div className="progress-line">
            <GitBranch size={16} />
            <strong>{progress.stage}</strong>
            <span>{progress.percent}%</span>
          </div>
          <div className="progress-track">
            <i style={{ width: `${progress.percent}%` }} />
          </div>
        </div>
      )}
      {tab === 'reasoning' ? (
        <ProofGraph run={run ?? null} />
      ) : tab === 'audit' ? (
        <AuditTimeline audit={item.audit} />
      ) : (
        <div className="detail-columns">
          <aside className="decision-column">
            <section className="panel decision-card" aria-label="Next response">
              <div className="decision-card-header">
                <span className="eyebrow">NEXT RESPONSE</span>
              </div>
              <h2>
                {!current
                  ? 'Ready for analysis'
                  : action
                    ? ACTION_LABELS[action]
                    : inconsistent
                      ? 'Resolve the conflict'
                      : solver?.status === 'multiple'
                        ? 'Human judgment required'
                        : 'Ready for analysis'}
              </h2>
              <p>
                {executed
                  ? item.execution?.mode === 'dry_run'
                    ? 'Your simulated response is saved. No message or payment was sent.'
                    : 'Your response is saved in the case record.'
                  : item.status === 'execution_uncertain'
                    ? 'The outcome of the response is uncertain. Reconcile the existing attempt before sending again.'
                    : item.status === 'executing'
                      ? 'Your response is being processed. Wait for the recorded outcome.'
                      : item.status === 'held'
                        ? 'This case is on hold. Add the missing evidence before reconsidering the response.'
                        : item.review
                          ? 'Your decision is recorded. Check the response before continuing.'
                          : !current
                            ? 'Check the evidence, then analyze this case to find the next step.'
                            : inconsistent
                              ? 'The evidence conflicts. Review the sources before choosing a response.'
                              : solver?.status === 'multiple'
                                ? 'More than one response is supported. Compare the evidence and record your judgment.'
                                : unique
                                  ? 'The evidence and policy support this response.'
                                  : 'The analysis is incomplete. Review the sources before choosing a response.'}
              </p>
              {current && (
                <p className="decision-outcome">
                  {unique
                    ? 'One consistent outcome'
                    : solver?.status === 'multiple' && solver.enumeration_complete
                      ? `${solver.models.length} valid outcomes`
                      : inconsistent
                        ? 'Conflicting evidence'
                        : 'Reasoning incomplete'}
                </p>
              )}
              {current && !item.review && result?.governance.requires_human && (
                <p className="decision-requirement">
                  Your review is required before a response can be sent.
                </p>
              )}
              {!current && !['executed', 'resolved'].includes(item.status) && (
                <button
                  className="button primary full"
                  disabled={workspace.busy}
                  onClick={() => safe(workspace.analyze(item.id))}
                >
                  <Play size={14} />
                  {run ? 'Re-analyze case' : 'Analyze case'}
                </button>
              )}
              {canReview && (
                <button
                  className="button primary full"
                  disabled={workspace.busy}
                  onClick={() => setDialog('review')}
                >
                  Review decision <ArrowRight size={14} />
                </button>
              )}
              {canExecute && (
                <>
                  <button
                    className="button primary full"
                    disabled={workspace.busy}
                    onClick={() => setDialog('execute')}
                  >
                    {simulated ? 'Simulate response' : 'Submit response'} <ArrowRight size={14} />
                  </button>
                  {simulated && (
                    <p className="decision-simulation-note">
                      Simulation only. No message or payment is sent to PayPal.
                    </p>
                  )}
                </>
              )}
              {executed && (
                <div className="execution-success">
                  <CircleCheck size={16} />
                  {simulated || item.execution?.mode === 'dry_run'
                    ? 'Simulation complete'
                    : 'Response submitted'}
                </div>
              )}
              {item.status === 'held' && <div className="held-note">This case is on hold.</div>}
              {item.review && (
                <div className="review-note">
                  <span className="eyebrow">YOUR DECISION</span>
                  <p>“{item.review.note}”</p>
                  <small>{date(item.review.created_at)} · Recorded by reviewer</small>
                </div>
              )}
              {item.execution && (
                <details className="execution-record">
                  <summary>
                    Execution record <ChevronDown size={14} />
                  </summary>
                  <div className="journal-note">
                    <div>
                      <span className={`journal-dot ${item.execution.status}`} />
                      <strong>{item.execution.status.replaceAll('_', ' ')}</strong>
                      <span>{item.execution.mode.replace('_', ' ')}</span>
                    </div>
                    {item.execution.error && <p>{item.execution.error}</p>}
                  </div>
                </details>
              )}
            </section>
            <details className="panel decision-details">
              <summary>
                Decision details <ChevronDown size={14} />
              </summary>
              <div className="decision-details-content">
                <ul className="decision-checks">
                  <li>
                    <span
                      className={
                        verified === item.data.evidence.length && verified ? 'check-positive' : ''
                      }
                    >
                      <CheckCheck size={14} />
                    </span>
                    Evidence provenance
                    <span>
                      {verified}/{item.data.evidence.length}
                    </span>
                  </li>
                  <li>
                    <span className={result?.knowledge_base?.rules.length ? 'check-positive' : ''}>
                      <FileText size={14} />
                    </span>
                    Exact policy citations<span>{result?.knowledge_base?.rules.length ?? '—'}</span>
                  </li>
                  <li>
                    <span className={solver?.enumeration_complete ? 'check-positive' : ''}>
                      <GitBranch size={14} />
                    </span>
                    Reasoning complete
                    <span>{solver?.enumeration_complete ? 'Yes' : 'Pending'}</span>
                  </li>
                  <li>
                    <span className={item.review ? 'check-positive' : ''}>
                      <ShieldCheck size={14} />
                    </span>
                    Human approval
                    <span>
                      {item.review
                        ? 'Recorded'
                        : result?.governance.requires_human
                          ? 'Required'
                          : result
                            ? 'Not required'
                            : 'Pending'}
                    </span>
                  </li>
                </ul>
                {result && (
                  <>
                    <div className="reasoning-brief">
                      <div className="section-heading">
                        <h3>How the decision was reached</h3>
                        <button className="text-button" onClick={() => setTab('reasoning')}>
                          Explore proof <ArrowUpRight size={13} />
                        </button>
                      </div>
                      <div className="reasoning-steps">
                        <div className="reasoning-step">
                          <span>01</span>
                          <div>
                            <strong>Establish the facts</strong>
                            <p>
                              {result.knowledge_base?.facts.length ?? 0} facts are linked to the
                              submitted evidence.
                            </p>
                          </div>
                          <FileCheck2 size={17} />
                        </div>
                        <div className="reasoning-step">
                          <span>02</span>
                          <div>
                            <strong>Apply the policy</strong>
                            <p>
                              {result.retrieval.clauses.length} exact clauses retrieved.{' '}
                              {result.knowledge_base?.priorities.length ?? 0} rule priorities
                              checked.
                            </p>
                          </div>
                          <FileText size={17} />
                        </div>
                        <div className="reasoning-step">
                          <span>03</span>
                          <div>
                            <strong>
                              {inconsistent
                                ? 'Flag the inconsistency'
                                : unique
                                  ? 'Resolve the exceptions'
                                  : solver?.status === 'multiple'
                                    ? 'Preserve all valid outcomes'
                                    : 'Complete the reasoning'}
                            </strong>
                            <p>
                              {unique
                                ? `${solver?.models[0].applied_rules.length ?? 0} rules applied; ${solver?.models[0].defeated_rules.length ?? 0} contrary rules defeated.`
                                : solver?.status === 'multiple'
                                  ? 'The evidence permits more than one conclusion. A reviewer chooses the response.'
                                  : inconsistent
                                    ? 'The verified facts cannot all hold together. A reviewer must assess the conflict.'
                                    : 'No complete analysis is available. Re-analyze this case or review its sources.'}
                            </p>
                          </div>
                          <GitBranch size={17} />
                        </div>
                      </div>
                    </div>
                    <div className="confidence">
                      <div>
                        <span>Operational confidence</span>
                        <strong>
                          {Math.round(result.governance.confidence * 100)}
                          <small>%</small>
                        </strong>
                      </div>
                      <div className="confidence-track">
                        <i style={{ width: `${result.governance.confidence * 100}%` }} />
                      </div>
                      <small>
                        {unique
                          ? 'A unique, complete reasoning outcome'
                          : solver?.status === 'multiple'
                            ? 'Multiple outcomes require a reviewer'
                            : inconsistent
                              ? 'No consistent decision established'
                              : 'Reasoning is incomplete or unavailable'}
                      </small>
                    </div>
                    <ul className="decision-reasons">
                      {result.governance.reasons.map((reason) => (
                        <li key={reason}>{reason}</li>
                      ))}
                    </ul>
                    <p>
                      This score reflects operational checks, not the probability of winning a
                      dispute.
                    </p>
                  </>
                )}
                {solver && (
                  <div className="source-integrity">
                    <ShieldCheck size={16} />
                    <div>
                      <strong>Analysis fingerprint</strong>
                      <p>Identifies the exact reasoning program used for this decision.</p>
                      <button
                        className="hash-copy mono"
                        aria-label="Copy analysis fingerprint"
                        onClick={() => {
                          void navigator.clipboard
                            .writeText(solver.program_sha256)
                            .then(() => {
                              setCopied(true);
                              setTimeout(() => setCopied(false), 1800);
                            })
                            .catch(() => setCopied(false));
                        }}
                      >
                        {shortHash(solver.program_sha256)}{' '}
                        {copied ? <Check size={12} /> : <Copy size={12} />}
                      </button>
                    </div>
                  </div>
                )}
                {current &&
                  !['executing', 'execution_uncertain', 'executed', 'resolved'].includes(
                    item.status,
                  ) && (
                    <button
                      className="button ghost full small"
                      disabled={workspace.busy}
                      onClick={() => safe(workspace.analyze(item.id))}
                    >
                      Run a new analysis
                    </button>
                  )}
              </div>
            </details>
          </aside>
          <div className="detail-main">
            {tab === 'overview' && (
              <section className="panel case-summary">
                <div className="section-heading">
                  <h2>Case summary</h2>
                </div>
                <p>{item.data.summary.replace(/FACT:-?[a-z0-9_]+/g, '').trim()}</p>
              </section>
            )}
            <section className="evidence-section">
              <div className="section-heading">
                <h2>Supporting evidence</h2>
              </div>
              {item.data.evidence.length ? (
                evidenceList
              ) : (
                <div className="empty-state">
                  <FileText size={28} />
                  <h3>No evidence yet</h3>
                  <p>Add a statement or record to begin this case.</p>
                </div>
              )}
            </section>
          </div>
        </div>
      )}
      {dialog === 'evidence' && <EvidenceDialog item={item} onClose={() => setDialog(null)} />}
      {dialog === 'review' && <ReviewDialog item={item} onClose={() => setDialog(null)} />}
      {dialog === 'execute' && <ExecuteDialog item={item} onClose={() => setDialog(null)} />}
    </div>
  );
}
