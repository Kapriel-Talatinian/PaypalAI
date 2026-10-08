import type { Action, WorkspaceCase } from '../types';

export const ACTION_LABELS: Record<Action, string> = {
  accept_claim: 'Accept claim',
  provide_evidence: 'Submit evidence',
  make_offer: 'Make an offer',
  escalate: 'Escalate to PayPal',
  send_message: 'Send a message',
  no_action: 'Hold case',
};

export const STATUS_LABELS: Record<string, string> = {
  open: 'Unprocessed',
  analyzing: 'Analyzing',
  review_required: 'Needs review',
  ready: 'Ready',
  reviewed: 'Approved',
  held: 'On hold',
  executed: 'Submitted',
  resolved: 'Resolved',
  executing: 'Submitting',
  execution_uncertain: 'Check outcome',
};

export function money(value: string | number, currency = 'USD', compact = false) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    ...(compact ? { maximumFractionDigits: 0, minimumFractionDigits: 0 } : {}),
  }).format(Number(value));
}

export function date(value: string, options?: Intl.DateTimeFormatOptions) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Paris',
    ...(options ?? { month: 'short', day: 'numeric' }),
  }).format(new Date(value));
}

export function caseCode(item: WorkspaceCase) {
  return item.external_id ?? `DF-${item.id.slice(0, 8).toUpperCase()}`;
}

export function decision(item: WorkspaceCase): Action | null {
  return item.review?.action ?? item.latest_run?.result?.governance.recommended_action ?? null;
}

export function exportFile(name: string, content: string, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function shortHash(hash: string) {
  return `${hash.slice(0, 12)}…${hash.slice(-6)}`;
}
