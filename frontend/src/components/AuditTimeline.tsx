import { useState } from 'react';
import {
  Check,
  ChevronDown,
  Copy,
  FileCheck2,
  GitBranch,
  LockKeyhole,
  ShieldCheck,
  ShieldX,
  UserRound,
} from 'lucide-react';
import type { AuditEvent, AuditResponse } from '../types';
import './proof.css';

export interface AuditTimelineProps {
  audit: AuditResponse | null;
  loading?: boolean;
}

const eventLabels: Record<string, string> = {
  case_created: 'Dispute opened',
  evidence_updated: 'Evidence updated',
  evidence_verified: 'Evidence verified',
  evidence_verification_updated: 'Evidence verification updated',
  analysis_queued: 'Analysis queued',
  analysis_started: 'Analysis started',
  analysis_completed: 'Analysis completed',
  analysis_failed: 'Analysis failed',
  analysis_stale: 'Analysis superseded',
  human_review: 'Human review recorded',
  human_reviewed: 'Human review recorded',
  review_recorded: 'Human review recorded',
  execution_started: 'Execution started',
  execution_succeeded: 'Action completed',
  execution_failed: 'Execution failed',
  execution_intent: 'Execution authorized',
  execution_uncertain: 'Execution outcome uncertain',
  execution_completed: 'Action completed',
  execution_reconciled: 'Execution reconciled',
  automatic_execution_deferred: 'Execution deferred',
  paypal_imported: 'PayPal dispute imported',
  paypal_dispute_imported: 'PayPal dispute imported',
};
const humanize = (value: string) =>
  value.replaceAll('_', ' ').replace(/^\w/, (letter) => letter.toUpperCase());

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return { time: '—', date: value };
  return {
    time: new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/Paris',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }).format(date),
    date: new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/Paris',
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    }).format(date),
  };
}

function eventSummary(event: AuditEvent) {
  const data = event.data;
  const summaries: string[] = [];
  if (typeof data.action === 'string') summaries.push(humanize(data.action));
  if (typeof data.status === 'string') summaries.push(humanize(data.status));
  if (typeof data.solver_status === 'string')
    summaries.push(`${humanize(data.solver_status)} solver result`);
  if (typeof data.case_version === 'number') summaries.push(`Revision ${data.case_version}`);
  if (typeof data.version === 'number') summaries.push(`Revision ${data.version}`);
  if (typeof data.mode === 'string') summaries.push(humanize(data.mode));
  if (typeof data.evidence_id === 'string') summaries.push(data.evidence_id);
  if (typeof data.note === 'string') return data.note;
  if (typeof data.error === 'string') return data.error;
  return summaries.join(' · ');
}

function EventIcon({ event }: { event: AuditEvent }) {
  if (event.kind.includes('review')) return <UserRound size={14} />;
  if (event.kind.includes('analysis')) return <GitBranch size={14} />;
  if (event.kind.includes('execut')) return <LockKeyhole size={14} />;
  return <FileCheck2 size={14} />;
}

export default function AuditTimeline({ audit, loading = false }: AuditTimelineProps) {
  const [copiedHash, setCopiedHash] = useState('');
  const [copyError, setCopyError] = useState('');
  async function copyHash(hash: string) {
    try {
      if (!navigator.clipboard) throw new Error('Clipboard is unavailable');
      await navigator.clipboard.writeText(hash);
      setCopiedHash(hash);
      setCopyError('');
      window.setTimeout(() => setCopiedHash((current) => (current === hash ? '' : current)), 1800);
    } catch {
      setCopyError('Copy unavailable. The full hash is available in the event details.');
    }
  }
  return (
    <section className="audit-panel" aria-label="Audit trail" aria-busy={loading}>
      <div className="audit-header">
        <div>
          <h2>Audit trail</h2>
          <p>A sequential record of evidence, analysis, and human decisions.</p>
        </div>
        {audit && (
          <span
            className={`audit-verification${audit.verified ? '' : ' audit-verification-failed'}`}
          >
            {audit.verified ? <ShieldCheck size={14} /> : <ShieldX size={14} />}
            {audit.verified ? 'Hash chain verified' : 'Verification failed'}
          </span>
        )}
      </div>
      {loading && !audit ? (
        <div className="audit-empty" role="status">
          Loading audit trail…
        </div>
      ) : !audit?.events.length ? (
        <div className="audit-empty">No audit events recorded yet.</div>
      ) : (
        <>
          <div className="audit-summary">
            <span>{audit.events.length} recorded events</span>
            <span>All times Europe / Paris</span>
          </div>
          <ol className="audit-events">
            {audit.events.map((event, index) => {
              const timestamp = formatDate(event.timestamp);
              const summary = eventSummary(event);
              return (
                <li
                  className={`audit-event${event.kind.includes('failed') ? ' audit-event-failed' : ''}`}
                  key={`${event.case_id}:${event.sequence}`}
                >
                  <div className="audit-event-track">
                    <span className="audit-event-marker">
                      <EventIcon event={event} />
                    </span>
                    {index < audit.events.length - 1 && <span className="audit-event-line" />}
                  </div>
                  <div className="audit-event-body">
                    <div className="audit-event-heading">
                      <h3>{eventLabels[event.kind] ?? humanize(event.kind)}</h3>
                      <span className="audit-sequence">
                        {String(event.sequence).padStart(2, '0')}
                      </span>
                      <time
                        dateTime={event.timestamp}
                        title={`${timestamp.date} ${timestamp.time} Europe/Paris`}
                      >
                        {timestamp.time}
                        <small>{timestamp.date}</small>
                      </time>
                    </div>
                    <div className="audit-event-actor">
                      <span>{event.actor}</span>
                      <code>{event.kind}</code>
                    </div>
                    {summary && <p className="audit-event-summary">{summary}</p>}
                    <details className="audit-event-details">
                      <summary>
                        Event details <ChevronDown size={12} />
                      </summary>
                      <div className="audit-event-record">
                        <div className="audit-hash-row">
                          <span>Event hash</span>
                          <button
                            type="button"
                            onClick={() => void copyHash(event.hash)}
                            aria-label={`Copy hash of event ${event.sequence}`}
                          >
                            {copiedHash === event.hash ? <Check size={12} /> : <Copy size={12} />}
                            {copiedHash === event.hash ? 'Copied' : 'Copy'}
                          </button>
                        </div>
                        <code className="audit-full-hash">{event.hash}</code>
                        <div className="audit-hash-row">
                          <span>Previous hash</span>
                        </div>
                        <code className="audit-full-hash">{event.previous_hash}</code>
                        <pre>{JSON.stringify(event.data, null, 2)}</pre>
                      </div>
                    </details>
                  </div>
                </li>
              );
            })}
          </ol>
          <div className="audit-chain-footer">
            <LockKeyhole size={14} />
            <div>
              <span>Current chain head</span>
              <code title={audit.head}>
                {audit.head.slice(0, 14)}…{audit.head.slice(-10)}
              </code>
            </div>
            <button
              type="button"
              onClick={() => void copyHash(audit.head)}
              aria-label="Copy current audit chain hash"
            >
              {copiedHash === audit.head ? <Check size={14} /> : <Copy size={14} />}
              {copiedHash === audit.head ? 'Copied' : 'Copy hash'}
            </button>
          </div>
        </>
      )}
      <div className="audit-copy-status" role="status" aria-live="polite">
        {copyError || (copiedHash ? 'Hash copied to clipboard.' : '')}
      </div>
    </section>
  );
}
