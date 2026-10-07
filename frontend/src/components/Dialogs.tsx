import { useId, useState } from 'react';
import type { FormEvent } from 'react';
import { ArrowRight, Check, Link2, ShieldCheck, FileText, Plus } from 'lucide-react';
import Modal from './Modal';
import { useWorkspace } from '../lib/store';
import type { Action, WorkspaceCase } from '../types';
import { ACTION_LABELS, caseCode } from '../lib/format';
import { draftResponse } from '../lib/response';

export function ConnectionDialog({ onClose }: { onClose: () => void }) {
  const workspace = useWorkspace();
  const [url, setUrl] = useState('/api');
  const [key, setKey] = useState('');
  const [reviewer, setReviewer] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      await workspace.connect(url, key, reviewer || undefined);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Connection failed.');
    } finally {
      setSubmitting(false);
    }
  }
  async function restoreDemo() {
    setError('');
    setSubmitting(true);
    try {
      await workspace.disconnect();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not restore the demo.');
    } finally {
      setSubmitting(false);
    }
  }
  return (
    <Modal
      title="Connect your workspace"
      subtitle="Use your DisputeFlow API to work with your own cases."
      onClose={onClose}
    >
      <div className="connection-illustration">
        <div className="mini-brand">
          D<span />
        </div>
        <span className="connection-line" />
        <Link2 size={18} />
        <span className="connection-line" />
        <div className="connection-api">API</div>
      </div>
      <form onSubmit={submit} className="form-stack">
        <label>
          API address
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="/api"
            required
            spellCheck={false}
          />
          <small>Use /api with the local launcher or Docker dashboard.</small>
        </label>
        <label>
          Workspace key
          <input
            type="password"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            required
            autoComplete="off"
            placeholder="Service API key"
          />
        </label>
        <label>
          Reviewer key <span className="optional">Optional</span>
          <input
            type="password"
            value={reviewer}
            onChange={(e) => setReviewer(e.target.value)}
            autoComplete="off"
            placeholder="Required for approval and execution"
          />
        </label>
        <p className="form-note">
          <ShieldCheck size={14} /> Keys stay in memory and are cleared when you reload.
        </p>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="modal-footer">
          <button type="button" className="button secondary" onClick={onClose}>
            Cancel
          </button>
          {workspace.connection.mode === 'api' && (
            <button
              type="button"
              className="button secondary"
              disabled={submitting}
              onClick={() => void restoreDemo()}
            >
              Return to demo
            </button>
          )}
          <button className="button primary" disabled={submitting}>
            {submitting ? 'Connecting…' : 'Connect API'}
            <ArrowRight size={14} />
          </button>
        </div>
      </form>
    </Modal>
  );
}

export function NewCaseDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const workspace = useWorkspace();
  const [name, setName] = useState('');
  const [amount, setAmount] = useState('89.00');
  const [currency, setCurrency] = useState('USD');
  const [reason, setReason] = useState('not_received');
  const [summary, setSummary] = useState('');
  const [paypalId, setPaypalId] = useState('');
  const [policyId, setPolicyId] = useState(
    workspace.policies.find((policy) => !policy.synthetic)?.id ??
      workspace.policies[0]?.id ??
      'demo_policy',
  );
  const [method, setMethod] = useState<'manual' | 'paypal'>('manual');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      const item =
        method === 'paypal'
          ? await workspace.importPayPal(paypalId.trim(), policyId)
          : await workspace.createCase(
              {
                external_id: `DF-${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
                reason,
                amount,
                currency,
                summary: summary.trim(),
                policy_id: policyId,
                auto_execute: false,
                allowed_actions: ['accept_claim', 'provide_evidence'],
                evidence: [
                  {
                    id: 'buyer_statement',
                    kind: 'statement',
                    content:
                      workspace.connection.mode === 'demo'
                        ? `${summary.trim()}\nSynthetic demo statement. FACT:${reason === 'not_received' ? 'claim_nonreceipt' : 'quality_complaint'}`
                        : summary.trim(),
                    verified: workspace.connection.mode === 'demo',
                    source: workspace.connection.mode === 'demo' ? 'synthetic_fixture' : 'operator',
                  },
                ],
              },
              {
                customer: name.trim(),
                initials: name
                  .split(' ')
                  .map((v) => v[0])
                  .slice(0, 2)
                  .join('')
                  .toUpperCase(),
                category: reason === 'not_received' ? 'Item not received' : 'Not as described',
              },
            );
      if (item) onCreated(item.id);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create case.');
    } finally {
      setSubmitting(false);
    }
  }
  return (
    <Modal
      title="Add a dispute"
      subtitle="Bring a new case into your review workspace."
      onClose={onClose}
    >
      {workspace.connection.mode === 'api' && (
        <div className="dialog-tabs">
          <button
            className={method === 'manual' ? 'active' : ''}
            onClick={() => setMethod('manual')}
          >
            Manual case
          </button>
          <button
            className={method === 'paypal' ? 'active' : ''}
            onClick={() => setMethod('paypal')}
          >
            Import from PayPal
          </button>
        </div>
      )}
      <form onSubmit={submit} className="form-stack">
        {method === 'paypal' ? (
          <label>
            PayPal dispute ID
            <input
              value={paypalId}
              onChange={(e) => setPaypalId(e.target.value)}
              placeholder="PP-D-…"
              required
            />
          </label>
        ) : (
          <>
            <label>
              Customer name
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Alex Morgan"
                required
                maxLength={100}
              />
              {workspace.connection.mode === 'api' && <small>Display name for this session.</small>}
            </label>
            <div className="form-row">
              <label>
                Disputed amount
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  required
                />
              </label>
              <label>
                Currency
                <select value={currency} onChange={(e) => setCurrency(e.target.value)}>
                  <option>USD</option>
                  <option>EUR</option>
                  <option>GBP</option>
                </select>
              </label>
            </div>
            <label>
              Reason
              <select value={reason} onChange={(e) => setReason(e.target.value)}>
                <option value="not_received">Item not received</option>
                <option value="not_as_described">Item not as described</option>
              </select>
            </label>
            <label>
              Customer statement
              <textarea
                value={summary}
                onChange={(e) => setSummary(e.target.value)}
                rows={4}
                placeholder="Summarize what happened and the customer's claim."
                required
                maxLength={20000}
              />
            </label>
          </>
        )}
        {(workspace.connection.mode === 'api' || workspace.policies.length > 1) && (
          <label>
            Policy document
            <select value={policyId} onChange={(e) => setPolicyId(e.target.value)} required>
              {workspace.policies.map((policy) => (
                <option key={policy.id} value={policy.id}>
                  {policy.title} · {policy.version}
                </option>
              ))}
            </select>
          </label>
        )}
        {workspace.connection.mode === 'demo' && (
          <p className="form-note">
            <FileText size={14} /> This creates a synthetic case in your demo workspace.
          </p>
        )}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="modal-footer">
          <button className="button secondary" type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="button primary" disabled={submitting}>
            <Plus size={14} />
            {submitting ? 'Adding…' : method === 'paypal' ? 'Import case' : 'Create case'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

export function ReviewDialog({ item, onClose }: { item: WorkspaceCase; onClose: () => void }) {
  const workspace = useWorkspace();
  const recommendation = item.latest_run?.result?.governance.recommended_action;
  const [action, setAction] = useState<Action>(
    recommendation && item.data.allowed_actions.includes(recommendation)
      ? recommendation
      : 'no_action',
  );
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const options = [...new Set([...item.data.allowed_actions, 'no_action' as Action])];
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!item.latest_run) return;
    setSubmitting(true);
    setError('');
    try {
      await workspace.review(item.latest_run.id, action, note.trim());
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Review failed.');
    } finally {
      setSubmitting(false);
    }
  }
  return (
    <Modal
      title="Record your decision"
      subtitle={`${caseCode(item)} · ${item.display.customer}`}
      onClose={onClose}
    >
      <form onSubmit={submit} className="form-stack">
        <div className="review-options" role="radiogroup" aria-label="Resolution action">
          {options.map((option) => (
            <label className={`review-option ${action === option ? 'selected' : ''}`} key={option}>
              <input
                type="radio"
                value={option}
                checked={action === option}
                onChange={() => setAction(option)}
                name="action"
              />
              <span>
                <strong>{ACTION_LABELS[option]}</strong>
                <small>
                  {option === recommendation
                    ? 'Recommended by the analysis'
                    : option === 'no_action'
                      ? 'Keep this case on hold'
                      : 'Available response for this case'}
                </small>
              </span>
              {action === option && <Check size={16} />}
            </label>
          ))}
        </div>
        <label>
          Review note
          <textarea
            rows={3}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            minLength={3}
            maxLength={4000}
            required
            placeholder="Explain the evidence and reasoning behind your decision."
          />
        </label>
        <p className="form-note">
          <ShieldCheck size={14} /> Your decision and note are added to the audit trail.
        </p>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="modal-footer">
          <button className="button secondary" type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="button primary" disabled={submitting}>
            {submitting ? 'Recording…' : 'Record decision'}
            <Check size={14} />
          </button>
        </div>
      </form>
    </Modal>
  );
}

export function EvidenceDialog({ item, onClose }: { item: WorkspaceCase; onClose: () => void }) {
  const workspace = useWorkspace();
  const [kind, setKind] = useState('statement');
  const [content, setContent] = useState('');
  const [verified, setVerified] = useState(false);
  const [exception, setException] = useState(false);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      await workspace.addEvidence(item.id, {
        id: `evidence_${crypto.randomUUID().slice(0, 8)}`,
        kind,
        content:
          exception && workspace.connection.mode === 'demo'
            ? `${content}\nFACT:tracking_invalid`
            : content,
        verified,
        source: workspace.connection.mode === 'demo' ? 'synthetic_fixture' : 'operator',
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add evidence.');
    } finally {
      setSubmitting(false);
    }
  }
  return (
    <Modal
      title="Add new evidence"
      subtitle="New evidence creates a fresh case version and replaces the previous recommendation."
      onClose={onClose}
    >
      <form onSubmit={submit} className="form-stack">
        <label>
          Evidence type
          <select value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="statement">Customer statement</option>
            <option value="tracking">Delivery / tracking record</option>
            <option value="inspection">Product inspection</option>
            <option value="other">Other evidence</option>
          </select>
        </label>
        <label>
          Evidence content
          <textarea
            rows={5}
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="Enter the evidence, its source, and any relevant details."
            required
            maxLength={40000}
          />
        </label>
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={verified}
            onChange={(e) => setVerified(e.target.checked)}
          />
          <span>I have verified the source of this evidence.</span>
        </label>
        {workspace.connection.mode === 'demo' && (
          <label className="checkbox-row demo-exception">
            <input
              type="checkbox"
              checked={exception}
              onChange={(e) => setException(e.target.checked)}
            />
            <span>
              Demo scenario: the delivery tracking is invalid.
              <small>Re-analysis demonstrates how a new fact changes the decision.</small>
            </span>
          </label>
        )}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="modal-footer">
          <button className="button secondary" type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="button primary" disabled={submitting}>
            {submitting ? 'Adding…' : 'Add evidence'}
            <Plus size={14} />
          </button>
        </div>
      </form>
    </Modal>
  );
}

export function ExecuteDialog({ item, onClose }: { item: WorkspaceCase; onClose: () => void }) {
  const workspace = useWorkspace();
  const noteId = useId();
  const action = item.review?.action ?? item.latest_run?.result?.governance.recommended_action;
  const [note, setNote] = useState(() => draftResponse(item, action));
  const [offer, setOffer] = useState(String(item.data.amount));
  const [offerType, setOfferType] = useState('REFUND');
  const [returnAddress, setReturnAddress] = useState({
    address_line_1: '',
    admin_area_2: '',
    postal_code: '',
    country_code: '',
  });
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const simulated =
    workspace.connection.mode === 'demo' || workspace.connection.executionMode === 'dry_run';
  const precision = ['JPY', 'HUF', 'TWD'].includes(item.data.currency)
    ? 0
    : ['BHD', 'IQD', 'JOD', 'KWD', 'LYD', 'OMR', 'TND'].includes(item.data.currency)
      ? 3
      : 2;
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!item.latest_run || !action || action === 'no_action') return;
    setError('');
    setSubmitting(true);
    const payload =
      action === 'provide_evidence'
        ? { evidences: [{ evidence_type: 'OTHER', notes: note.trim() }] }
        : action === 'send_message'
          ? { message: note.trim() }
          : action === 'make_offer'
            ? {
                note: note.trim(),
                offer_type: offerType,
                offer_amount: {
                  value: Number(offer).toFixed(precision),
                  currency_code: item.data.currency,
                },
                ...(offerType === 'REFUND_WITH_RETURN'
                  ? {
                      return_shipping_address: Object.fromEntries(
                        Object.entries(returnAddress)
                          .filter(([, value]) => value.trim())
                          .map(([key, value]) => [key, value.trim()]),
                      ),
                    }
                  : {}),
              }
            : { note: note.trim() };
    try {
      await workspace.execute(item.latest_run.id, payload);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not submit response.');
    } finally {
      setSubmitting(false);
    }
  }
  return (
    <Modal
      title={simulated ? 'Simulate your response' : 'Submit your PayPal response'}
      subtitle={`${caseCode(item)} · ${action ? ACTION_LABELS[action] : 'Response'}`}
      onClose={onClose}
    >
      <div className={`execution-context ${simulated ? '' : 'execution-context-live'}`}>
        <ShieldCheck size={19} />
        <div>
          <strong>{simulated ? 'A complete rehearsal' : 'External PayPal action'}</strong>
          <p>
            {simulated
              ? 'The response is recorded in the execution journal. No message or payment is sent to PayPal.'
              : 'This submits the approved response to PayPal. Review the details before continuing.'}
          </p>
        </div>
      </div>
      <form className="form-stack" onSubmit={submit}>
        {action === 'make_offer' && (
          <>
            <div className="form-row">
              <label>
                Offer amount ({item.data.currency})
                <input
                  value={offer}
                  type="number"
                  min={10 ** -precision}
                  max={Number(item.data.amount)}
                  step={10 ** -precision}
                  onChange={(e) => setOffer(e.target.value)}
                  required
                />
              </label>
              <label>
                Offer type
                <select value={offerType} onChange={(e) => setOfferType(e.target.value)}>
                  <option value="REFUND">Refund</option>
                  <option value="REFUND_WITH_RETURN">Refund with return</option>
                </select>
              </label>
            </div>
            {offerType === 'REFUND_WITH_RETURN' && (
              <>
                <label>
                  Return street address
                  <input
                    value={returnAddress.address_line_1}
                    onChange={(e) =>
                      setReturnAddress({ ...returnAddress, address_line_1: e.target.value })
                    }
                    required
                    maxLength={300}
                  />
                </label>
                <div className="form-row">
                  <label>
                    City
                    <input
                      value={returnAddress.admin_area_2}
                      onChange={(e) =>
                        setReturnAddress({ ...returnAddress, admin_area_2: e.target.value })
                      }
                      maxLength={120}
                    />
                  </label>
                  <label>
                    Postal code
                    <input
                      value={returnAddress.postal_code}
                      onChange={(e) =>
                        setReturnAddress({ ...returnAddress, postal_code: e.target.value })
                      }
                      maxLength={60}
                    />
                  </label>
                </div>
                <label>
                  Country code
                  <input
                    value={returnAddress.country_code}
                    onChange={(e) =>
                      setReturnAddress({
                        ...returnAddress,
                        country_code: e.target.value.toUpperCase(),
                      })
                    }
                    placeholder="FR"
                    pattern="[A-Z]{2}|C2"
                    required
                    maxLength={2}
                  />
                </label>
              </>
            )}
          </>
        )}
        <div className="response-note-field">
          <label htmlFor={noteId}>
            {action === 'provide_evidence'
              ? 'Evidence to submit'
              : action === 'send_message'
                ? 'Message to the customer'
                : 'Response note'}
          </label>
          <textarea
            id={noteId}
            rows={4}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={
              action === 'provide_evidence'
                ? 'Provide the supporting facts and evidence for your response.'
                : 'Write the note to accompany this response.'
            }
            required
            maxLength={2000}
          />
        </div>
        {action === 'provide_evidence' && draftResponse(item, action) && (
          <p className="form-note">
            <FileText size={14} />
            Draft uses excerpts from verified evidence. Review and edit it before sending.
          </p>
        )}
        {item.data.policy_id === 'demo_policy' && (
          <p className="form-note">This case uses a synthetic demonstration policy.</p>
        )}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="modal-footer">
          <button type="button" className="button secondary" onClick={onClose}>
            Cancel
          </button>
          <button className="button primary" disabled={submitting}>
            {submitting ? 'Submitting…' : simulated ? 'Run simulation' : 'Submit response'}
            <ArrowRight size={14} />
          </button>
        </div>
      </form>
    </Modal>
  );
}
