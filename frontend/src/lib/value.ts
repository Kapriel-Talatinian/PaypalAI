import type { Action, AnalysisResult, RunView, WorkspaceCase } from '../types';

export type ValueCurrency = 'USD' | 'EUR' | 'GBP';
export interface ValueInputs {
  manualMinutes: number;
  assistedMinutes: number;
  hourlyCost: number;
  monthlyCases: number;
  monthlyFee: number;
  currency: ValueCurrency;
}
export interface ValueProjection {
  minutesSavedPerCase: number;
  hoursSavedPerCase: number;
  monthlyHoursSaved: number;
  valuePerCase: number;
  monthlyGrossValue: number;
  monthlyNetValue: number;
  roiPercent: number | null;
  breakEvenCases: number | null;
}
export interface ValueValidation {
  valid: boolean;
  errors: Partial<Record<keyof ValueInputs, string>>;
}
export interface ValueMetrics {
  totalCases: number;
  activeCases: number;
  currentAnalyses: number;
  actionableRecommendations: number;
  pendingApprovals: number;
  reviewedReady: number;
  quickWinCount: number;
}
export interface QuickWinOptions {
  currency?: ValueCurrency;
  now?: Date | string | number;
}
export type CurrentRunCase = WorkspaceCase & {
  latest_run: RunView & { result: AnalysisResult };
};

/** Editable illustration only: these values are not observed performance or prices. */
export const DEFAULT_VALUE_INPUTS: Readonly<ValueInputs> = Object.freeze({
  manualMinutes: 25,
  assistedMinutes: 5,
  hourlyCost: 35,
  monthlyCases: 100,
  monthlyFee: 99,
  currency: 'USD',
});

const INPUT_LIMITS: Record<Exclude<keyof ValueInputs, 'currency'>, number> = {
  manualMinutes: 1440,
  assistedMinutes: 1440,
  hourlyCost: 10000,
  monthlyCases: 100000,
  monthlyFee: 100000,
};
const INPUT_LABELS: Record<Exclude<keyof ValueInputs, 'currency'>, string> = {
  manualMinutes: 'Manual minutes',
  assistedMinutes: 'Assisted minutes',
  hourlyCost: 'Hourly cost',
  monthlyCases: 'Monthly cases',
  monthlyFee: 'Monthly fee',
};
export class ValueInputError extends RangeError {
  readonly errors: ValueValidation['errors'];
  constructor(errors: ValueValidation['errors']) {
    super(Object.values(errors).join(' '));
    this.name = 'ValueInputError';
    this.errors = errors;
  }
}

export function validateValueInputs(inputs: ValueInputs): ValueValidation {
  const errors: ValueValidation['errors'] = {};
  for (const field of Object.keys(INPUT_LIMITS) as (keyof typeof INPUT_LIMITS)[]) {
    const value = inputs?.[field];
    const label = INPUT_LABELS[field];
    if (typeof value !== 'number' || !Number.isFinite(value))
      errors[field] = `${label} must be a finite number.`;
    else if (value < 0 || value > INPUT_LIMITS[field])
      errors[field] = `${label} must be between 0 and ${INPUT_LIMITS[field]}.`;
    else if (field === 'monthlyCases' && !Number.isInteger(value))
      errors[field] = 'Monthly cases must be a whole number.';
  }
  if (!['USD', 'EUR', 'GBP'].includes(inputs?.currency))
    errors.currency = 'Choose USD, EUR, or GBP for the estimate.';
  return { valid: Object.keys(errors).length === 0, errors };
}

/** Estimate labor capacity value from explicit assumptions; do not round intermediate math. */
export function calculateValue(inputs: ValueInputs): ValueProjection {
  const validation = validateValueInputs(inputs);
  if (!validation.valid) throw new ValueInputError(validation.errors);
  const minutesSavedPerCase = inputs.manualMinutes - inputs.assistedMinutes;
  const hoursSavedPerCase = minutesSavedPerCase / 60;
  const monthlyHoursSaved = hoursSavedPerCase * inputs.monthlyCases;
  const valuePerCase = hoursSavedPerCase * inputs.hourlyCost;
  const monthlyGrossValue = monthlyHoursSaved * inputs.hourlyCost;
  const monthlyNetValue = monthlyGrossValue - inputs.monthlyFee;
  const roiPercent = inputs.monthlyFee > 0 ? (monthlyNetValue / inputs.monthlyFee) * 100 : null;
  const breakEvenCases =
    inputs.monthlyFee === 0
      ? 0
      : valuePerCase > 0
        ? Math.ceil(inputs.monthlyFee / valuePerCase)
        : null;
  return {
    minutesSavedPerCase,
    hoursSavedPerCase,
    monthlyHoursSaved,
    valuePerCase,
    monthlyGrossValue,
    monthlyNetValue,
    roiPercent,
    breakEvenCases,
  };
}

/** Display rounding only; calculations above retain their original precision. */
export function roundMoney(value: number): number {
  if (!Number.isFinite(value)) throw new RangeError('Money must be a finite number.');
  const rounded = (Math.sign(value) * Math.round((Math.abs(value) + Number.EPSILON) * 100)) / 100;
  return rounded === 0 ? 0 : rounded;
}

const CLOSED_OR_HELD = new Set(['executed', 'resolved', 'held']);
const LOCKED_FOR_RESPONSE = new Set([
  'executed',
  'resolved',
  'held',
  'executing',
  'execution_uncertain',
]);
const executable = (
  action: Action | null | undefined,
  item: WorkspaceCase,
): action is Exclude<Action, 'no_action'> =>
  Boolean(action && action !== 'no_action' && item.data.allowed_actions.includes(action));

export function isCurrentRun(item: WorkspaceCase): item is CurrentRunCase {
  const run = item.latest_run;
  return Boolean(
    run &&
    run.status === 'completed' &&
    run.result &&
    run.case_version === item.version &&
    run.case_id === item.id &&
    item.latest_run_id === run.id,
  );
}
function responseAvailable(item: WorkspaceCase): boolean {
  return (
    !LOCKED_FOR_RESPONSE.has(item.status) && !item.execution && item.review?.action !== 'no_action'
  );
}
function quickWin(item: WorkspaceCase): boolean {
  if (!isCurrentRun(item) || !responseAvailable(item)) return false;
  const { solver, governance } = item.latest_run.result;
  return Boolean(
    solver?.status === 'unique' &&
    solver.enumeration_complete &&
    solver.models.length === 1 &&
    executable(governance.recommended_action, item) &&
    (!item.review || executable(item.review.action, item)),
  );
}
function referenceTime(now: QuickWinOptions['now']): number {
  const value =
    now === undefined
      ? Date.now()
      : now instanceof Date
        ? now.getTime()
        : typeof now === 'number'
          ? now
          : Date.parse(now);
  if (!Number.isFinite(value)) throw new RangeError('The priority reference date must be valid.');
  return value;
}
function deadline(item: WorkspaceCase, now: number): number {
  const value = item.display.dueAt ? Date.parse(item.display.dueAt) : Number.NaN;
  return Number.isFinite(value) ? value - now : Number.POSITIVE_INFINITY;
}

/** Safe, current decisions. Deadline comes first; amounts are compared within one currency. */
export function getQuickWins(
  cases: readonly WorkspaceCase[],
  options: QuickWinOptions = {},
): WorkspaceCase[] {
  const now = referenceTime(options.now);
  return cases.filter(quickWin).sort((left, right) => {
    const leftDue = deadline(left, now);
    const rightDue = deadline(right, now);
    if (leftDue !== rightDue) return leftDue < rightDue ? -1 : 1;
    const reviewed = Number(Boolean(right.review)) - Number(Boolean(left.review));
    if (reviewed) return reviewed;
    if (
      options.currency &&
      (left.data.currency === options.currency) !== (right.data.currency === options.currency)
    )
      return left.data.currency === options.currency ? -1 : 1;
    // Group other currencies consistently so cross-currency comparisons stay transitive.
    const currency = left.data.currency.localeCompare(right.data.currency);
    if (currency) return currency;
    const amount = Number(right.data.amount) - Number(left.data.amount);
    if (Number.isFinite(amount) && amount !== 0) return amount;
    return left.id.localeCompare(right.id);
  });
}

/** Current evidence-submission responses, with verified content. This does not classify buyer fraud or predict recovered money. */
export function getRevenueDefenseCases(
  cases: readonly WorkspaceCase[],
  options: QuickWinOptions = {},
): WorkspaceCase[] {
  return getQuickWins(cases, options).filter((item) => {
    const action = item.review?.action ?? item.latest_run?.result?.governance.recommended_action;
    return (
      action === 'provide_evidence' &&
      item.data.evidence.some((evidence) => evidence.verified && evidence.content.trim().length > 0)
    );
  });
}

export function getValueMetrics(cases: readonly WorkspaceCase[]): ValueMetrics {
  const current = cases.filter(isCurrentRun);
  const active = cases.filter((item) => !CLOSED_OR_HELD.has(item.status));
  const actionableRecommendations = cases.filter(quickWin).length;
  const pendingApprovals = current.filter(
    (item) =>
      responseAvailable(item) && !item.review && item.latest_run.result.governance.requires_human,
  ).length;
  const reviewedReady = current.filter(
    (item) => responseAvailable(item) && item.review && executable(item.review.action, item),
  ).length;
  return {
    totalCases: cases.length,
    activeCases: active.length,
    currentAnalyses: current.length,
    actionableRecommendations,
    pendingApprovals,
    reviewedReady,
    quickWinCount: actionableRecommendations,
  };
}

/** Unresolved disputed amount, including held cases and submitted or simulated responses. Keep each currency separate. */
export function getExposureByCurrency(cases: readonly WorkspaceCase[]): Record<string, number> {
  const exposure: Record<string, number> = {};
  for (const item of cases) {
    if (item.status === 'resolved') continue;
    const amount = Number(item.data.amount);
    if (!Number.isFinite(amount) || amount < 0)
      throw new RangeError(`Case ${item.id} has an invalid disputed amount.`);
    const currency = item.data.currency;
    if (!/^[A-Z]{3}$/.test(currency))
      throw new RangeError(`Case ${item.id} has an invalid currency.`);
    exposure[currency] = (exposure[currency] ?? 0) + amount;
  }
  return exposure;
}
