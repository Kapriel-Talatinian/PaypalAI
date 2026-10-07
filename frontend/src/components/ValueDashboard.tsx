import { useId, useMemo, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { ArrowRight, ChevronDown } from 'lucide-react';
import type { WorkspaceCase } from '../types';
import { ACTION_LABELS, caseCode, money } from '../lib/format';
import {
  calculateValue,
  DEFAULT_VALUE_INPUTS,
  getExposureByCurrency,
  getQuickWins,
  getRevenueDefenseCases,
  getValueMetrics,
  roundMoney,
  validateValueInputs,
} from '../lib/value';
import type { ValueCurrency, ValueInputs } from '../lib/value';
import './value-dashboard.css';

export interface ValueDashboardProps {
  cases: WorkspaceCase[];
  mode: 'demo' | 'api';
  onOpen: (item: WorkspaceCase) => void;
  onReviewQueue: () => void;
  draft?: ValueDraft;
  onDraftChange?: Dispatch<SetStateAction<ValueDraft>>;
}

type NumericInput = Exclude<keyof ValueInputs, 'currency'>;
export type ValueDraft = Record<NumericInput, string> & { currency: ValueCurrency };
const numericFields: { key: NumericInput; label: string; maximum: number; step: string }[] = [
  { key: 'manualMinutes', label: 'Manual handling (min / case)', maximum: 1440, step: 'any' },
  { key: 'assistedMinutes', label: 'Assisted handling (min / case)', maximum: 1440, step: 'any' },
  { key: 'hourlyCost', label: 'Hourly team cost', maximum: 10000, step: 'any' },
  { key: 'monthlyCases', label: 'Cases per month', maximum: 100000, step: '1' },
  { key: 'monthlyFee', label: 'Monthly software cost', maximum: 100000, step: 'any' },
];
const numberFormat = new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 });
const integerFormat = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
export const createValueDraft = (): ValueDraft => ({
  manualMinutes: String(DEFAULT_VALUE_INPUTS.manualMinutes),
  assistedMinutes: String(DEFAULT_VALUE_INPUTS.assistedMinutes),
  hourlyCost: String(DEFAULT_VALUE_INPUTS.hourlyCost),
  monthlyCases: String(DEFAULT_VALUE_INPUTS.monthlyCases),
  monthlyFee: String(DEFAULT_VALUE_INPUTS.monthlyFee),
  currency: DEFAULT_VALUE_INPUTS.currency,
});
const parseInput = (value: string) => (value.trim() === '' ? Number.NaN : Number(value));

export default function ValueDashboard({
  cases,
  mode,
  onOpen,
  onReviewQueue,
  draft: controlledDraft,
  onDraftChange,
}: ValueDashboardProps) {
  const [localDraft, setLocalDraft] = useState<ValueDraft>(createValueDraft);
  const draft = controlledDraft ?? localDraft;
  const setDraft = onDraftChange ?? setLocalDraft;
  const inputId = useId().replaceAll(':', '');
  const inputs: ValueInputs = {
    manualMinutes: parseInput(draft.manualMinutes),
    assistedMinutes: parseInput(draft.assistedMinutes),
    hourlyCost: parseInput(draft.hourlyCost),
    monthlyCases: parseInput(draft.monthlyCases),
    monthlyFee: parseInput(draft.monthlyFee),
    currency: draft.currency,
  };
  const validation = validateValueInputs(inputs);
  const projection = validation.valid ? calculateValue(inputs) : null;
  const metrics = useMemo(() => getValueMetrics(cases), [cases]);
  const exposure = useMemo(() => getExposureByCurrency(cases), [cases]);
  const exposureGroups = Object.entries(exposure).sort(([left], [right]) => {
    if (left === 'USD') return -1;
    if (right === 'USD') return 1;
    return left.localeCompare(right);
  });
  const defenseCases = useMemo(() => getRevenueDefenseCases(cases), [cases]);
  const next = useMemo(() => defenseCases[0] ?? getQuickWins(cases)[0], [cases, defenseCases]);
  const nextAction =
    next?.review?.action ?? next?.latest_run?.result?.governance.recommended_action;
  const netValue = projection
    ? money(roundMoney(projection.monthlyNetValue), inputs.currency)
    : '—';
  const isNegative = Boolean(projection && projection.monthlyNetValue < 0);
  const verifiedSources = next?.data.evidence.filter((item) => item.verified).length ?? 0;

  return (
    <section
      className="value-dashboard"
      data-testid="value-dashboard"
      aria-label="Next claim and disputed revenue"
    >
      <section className="value-next-response" aria-labelledby={`${inputId}-next-heading`}>
        <h2 id={`${inputId}-next-heading`}>Next claim to review</h2>
        {next && nextAction ? (
          <div className="value-next-body">
            <div className="value-next-case">
              <h3>{next.display.customer}</h3>
              <p className="value-next-reference">
                {caseCode(next)} <span>·</span> {money(next.data.amount, next.data.currency)}
              </p>
              <p className="value-next-action">
                <strong>{ACTION_LABELS[nextAction]}</strong>
                <span>{next.review ? 'Approved response' : 'Ready for your review'}</span>
              </p>
              <p className="value-next-source">
                {nextAction === 'provide_evidence'
                  ? 'Verified evidence supports a merchant response.'
                  : `One clear outcome, with ${verifiedSources} verified ${verifiedSources === 1 ? 'source' : 'sources'}.`}
              </p>
            </div>
            <button
              type="button"
              className="value-next-button"
              data-testid="next-value-action"
              onClick={() => onOpen(next)}
            >
              {next.review ? 'Open next case' : 'Review next response'}
              <ArrowRight size={15} aria-hidden="true" />
            </button>
          </div>
        ) : (
          <div className="value-next-body">
            <div className="value-next-case">
              <h3>
                {metrics.pendingApprovals ? 'Start with the evidence' : 'No response ready yet'}
              </h3>
              <p className="value-next-source">
                {metrics.pendingApprovals
                  ? 'These cases need your judgment before a response can be recommended.'
                  : 'A response appears here when its analysis is current and complete.'}
              </p>
            </div>
            <button
              type="button"
              className="value-next-button"
              data-testid="next-value-action"
              onClick={onReviewQueue}
            >
              Open review queue
              <ArrowRight size={15} aria-hidden="true" />
            </button>
          </div>
        )}
        <details className="value-case-totals">
          <summary>
            Case totals <ChevronDown size={14} aria-hidden="true" />
          </summary>
          <div className="value-case-totals-content">
            <dl className="value-case-counts">
              <div>
                <dt>Ready recommendations</dt>
                <dd data-testid="value-quick-wins">
                  {String(metrics.actionableRecommendations).padStart(2, '0')}
                </dd>
              </div>
              <div>
                <dt>Awaiting your review</dt>
                <dd data-testid="value-pending-approvals">
                  {String(metrics.pendingApprovals).padStart(2, '0')}
                </dd>
              </div>
              <div>
                <dt>Approved for response</dt>
                <dd data-testid="value-reviewed-ready">
                  {String(metrics.reviewedReady).padStart(2, '0')}
                </dd>
              </div>
            </dl>
            <button className="value-review-link" type="button" onClick={onReviewQueue}>
              Open review queue
              <ArrowRight size={13} aria-hidden="true" />
            </button>
          </div>
        </details>
      </section>
      <section className="value-roi" aria-labelledby={`${inputId}-value-heading`}>
        <div className="value-roi-heading">
          <h2 id={`${inputId}-value-heading`}>Revenue under dispute</h2>
          <span>{mode === 'demo' ? 'Demo data' : 'Workspace data'}</span>
        </div>
        <div className="value-revenue-amounts" aria-live="polite" aria-atomic="true">
          {exposureGroups.length ? (
            exposureGroups.map(([currency, amount]) => (
              <div key={currency}>
                <strong data-testid={`value-exposure-${currency}`}>
                  {money(roundMoney(amount), currency)}
                </strong>
                <span>{currency}</span>
              </div>
            ))
          ) : (
            <strong className="value-no-revenue">No unresolved claims</strong>
          )}
        </div>
        <p className="value-revenue-context">
          {cases.filter((item) => item.status !== 'resolved').length} unresolved claims ·{' '}
          {defenseCases.length} evidence-ready{' '}
          {defenseCases.length === 1 ? 'response' : 'responses'}
        </p>
        <p className="value-revenue-caption">Unresolved claims, not recovered revenue.</p>
        <details className="value-assumptions">
          <summary>
            Edit assumptions <ChevronDown size={14} aria-hidden="true" />
          </summary>
          <div className="value-assumptions-content">
            <h3 className="value-labor-title">Projected monthly value</h3>
            <div className="value-roi-results" aria-live="polite" aria-atomic="true">
              <div className="value-monthly-total">
                <strong
                  className={`value-net-value${isNegative ? ' value-figure-negative' : ''}${netValue.length > 15 ? ' value-net-long' : ''}`}
                  data-testid="roi-net-value"
                >
                  {netValue}
                </strong>
                <span>{inputs.currency} / month · estimated labor value</span>
              </div>
              <div className="value-monthly-hours">
                <strong
                  className={
                    projection && projection.monthlyHoursSaved < 0 ? 'value-figure-negative' : ''
                  }
                  data-testid="roi-hours"
                >
                  {projection ? `${numberFormat.format(projection.monthlyHoursSaved)} h` : '—'}
                </strong>
                <span>
                  {projection && projection.monthlyHoursSaved < 0
                    ? 'time difference / month'
                    : 'projected hours saved / month'}
                </span>
              </div>
            </div>
            <p className="value-illustration-note">
              Illustrative inputs — edit to match your team.
            </p>
            <p className="value-formula-note">
              Time value − monthly cost. No dispute recoveries included.
            </p>

            <dl className="value-detailed-roi">
              <div>
                <dt>Projected ROI</dt>
                <dd className={isNegative ? 'value-figure-negative' : ''} data-testid="roi-percent">
                  {projection?.roiPercent === null || !projection
                    ? '—'
                    : `${integerFormat.format(projection.roiPercent)}%`}
                </dd>
                {projection?.roiPercent === null && <small>No monthly cost</small>}
              </div>
              <div>
                <dt>Cases to break even</dt>
                <dd data-testid="roi-break-even">
                  {projection
                    ? projection.breakEvenCases === null
                      ? 'Not reached'
                      : `${integerFormat.format(projection.breakEvenCases)} cases`
                    : '—'}
                </dd>
              </div>
              <div>
                <dt>Per-case time difference</dt>
                <dd
                  className={
                    projection && projection.minutesSavedPerCase < 0 ? 'value-figure-negative' : ''
                  }
                >
                  {projection ? `${numberFormat.format(projection.minutesSavedPerCase)} min` : '—'}
                </dd>
              </div>
            </dl>
            <div className="value-input-grid">
              {numericFields.map(({ key, label, maximum, step }) => (
                <label className="value-input" key={key} htmlFor={`${inputId}-${key}`}>
                  <span>
                    {label}
                    {(key === 'hourlyCost' || key === 'monthlyFee') && (
                      <small>{inputs.currency}</small>
                    )}
                  </span>
                  <input
                    id={`${inputId}-${key}`}
                    type="number"
                    min="0"
                    max={maximum}
                    step={step}
                    required
                    value={draft[key]}
                    aria-invalid={Boolean(validation.errors[key])}
                    aria-describedby={
                      validation.errors[key] ? `${inputId}-${key}-error` : undefined
                    }
                    onChange={(event) =>
                      setDraft((current) => ({ ...current, [key]: event.target.value }))
                    }
                  />
                  {validation.errors[key] && (
                    <span className="value-input-error" id={`${inputId}-${key}-error`}>
                      {validation.errors[key]}
                    </span>
                  )}
                </label>
              ))}
              <label className="value-input" htmlFor={`${inputId}-currency`}>
                <span>Scenario currency</span>
                <select
                  id={`${inputId}-currency`}
                  value={draft.currency}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      currency: event.target.value as ValueCurrency,
                    }))
                  }
                >
                  <option value="USD">USD — US dollar</option>
                  <option value="EUR">EUR — Euro</option>
                  <option value="GBP">GBP — Pound sterling</option>
                </select>
              </label>
            </div>
            <div className="value-assumptions-footer">
              <p>
                {validation.valid && projection ? (
                  <>
                    Gross time value:{' '}
                    <strong>
                      {money(roundMoney(projection.monthlyGrossValue), inputs.currency)}
                    </strong>{' '}
                    · Assumed monthly cost:{' '}
                    <strong>{money(inputs.monthlyFee, inputs.currency)}</strong>
                  </>
                ) : (
                  'Correct the highlighted inputs to calculate this scenario.'
                )}
              </p>
              <button type="button" onClick={() => setDraft(createValueDraft())}>
                Reset illustration
              </button>
            </div>
            <p className="value-assumption-disclosure">
              Handling times, team cost, case volume, and software cost are your assumptions. These
              inputs do not describe measured performance or subscription pricing.
              {validation.valid &&
                inputs.assistedMinutes > inputs.manualMinutes &&
                ' Assisted handling is slower in this scenario; the calculation includes additional labor time.'}
            </p>
          </div>
        </details>
      </section>
    </section>
  );
}
