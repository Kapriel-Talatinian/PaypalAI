import { expect, test } from '@playwright/test';
import { clone, createDemoCases } from '../src/data/demo';
import {
  calculateValue,
  DEFAULT_VALUE_INPUTS,
  getExposureByCurrency,
  getQuickWins,
  getRevenueDefenseCases,
  getValueMetrics,
  isCurrentRun,
  roundMoney,
  validateValueInputs,
  ValueInputError,
  type ValueInputs,
} from '../src/lib/value';

const inputs = (changes: Partial<ValueInputs> = {}): ValueInputs => ({
  ...DEFAULT_VALUE_INPUTS,
  ...changes,
});
const reference = '2026-10-07T12:00:00+02:00';

test('illustrative defaults preserve exact arithmetic and expose their break-even volume', () => {
  const value = calculateValue(inputs());
  expect(value.minutesSavedPerCase).toBe(20);
  expect(value.hoursSavedPerCase).toBeCloseTo(1 / 3, 12);
  expect(value.monthlyHoursSaved).toBeCloseTo(100 / 3, 12);
  expect(value.valuePerCase).toBeCloseTo(35 / 3, 12);
  expect(value.monthlyGrossValue).toBeCloseTo(3500 / 3, 10);
  expect(value.monthlyNetValue).toBeCloseTo(3500 / 3 - 99, 10);
  expect(value.roiPercent).toBeCloseTo(((3500 / 3 - 99) / 99) * 100, 10);
  expect(value.breakEvenCases).toBe(9);
  expect(roundMoney(value.monthlyNetValue)).toBe(1067.67);
  expect(DEFAULT_VALUE_INPUTS.monthlyFee).toBe(99);
});

test('higher assisted time adds labor cost, while no cost and no volume preserve the fee loss', () => {
  for (const assumptions of [inputs({ hourlyCost: 0 }), inputs({ monthlyCases: 0 })]) {
    const value = calculateValue(assumptions);
    expect(value.monthlyGrossValue).toBe(0);
    expect(value.monthlyNetValue).toBe(-99);
    expect(value.roiPercent).toBe(-100);
  }
  const slower = calculateValue(inputs({ assistedMinutes: 40 }));
  expect(slower.minutesSavedPerCase).toBe(-15);
  expect(slower.monthlyHoursSaved).toBe(-25);
  expect(slower.monthlyGrossValue).toBe(-875);
  expect(slower.monthlyNetValue).toBe(-974);
  expect(slower.roiPercent).toBeCloseTo((-974 / 99) * 100, 10);
  expect(slower.breakEvenCases).toBeNull();
  expect(
    calculateValue(inputs({ manualMinutes: 5, assistedMinutes: 5 })).breakEvenCases,
  ).toBeNull();
  expect(calculateValue(inputs({ hourlyCost: 0 })).breakEvenCases).toBeNull();
});

test('zero fee does not invent an infinite ROI and can break even with no savings', () => {
  const value = calculateValue(inputs({ monthlyFee: 0 }));
  expect(value.roiPercent).toBeNull();
  expect(value.breakEvenCases).toBe(0);
  expect(value.monthlyNetValue).toBe(value.monthlyGrossValue);
  const zero = calculateValue(
    inputs({ manualMinutes: 0, assistedMinutes: 0, hourlyCost: 0, monthlyCases: 0, monthlyFee: 0 }),
  );
  expect(zero.monthlyHoursSaved).toBe(0);
  expect(zero.monthlyNetValue).toBe(0);
  expect(zero.roiPercent).toBeNull();
  expect(zero.breakEvenCases).toBe(0);
});

test('low volume produces a negative ROI and break-even rounds up to the next case', () => {
  const value = calculateValue(
    inputs({
      manualMinutes: 20,
      assistedMinutes: 5,
      hourlyCost: 40,
      monthlyCases: 1,
      monthlyFee: 25,
    }),
  );
  expect(value.valuePerCase).toBe(10);
  expect(value.monthlyGrossValue).toBe(10);
  expect(value.monthlyNetValue).toBe(-15);
  expect(value.roiPercent).toBe(-60);
  expect(value.breakEvenCases).toBe(3);
});

test('every invalid or excessive numeric assumption is rejected instead of becoming NaN', () => {
  const fields = [
    'manualMinutes',
    'assistedMinutes',
    'hourlyCost',
    'monthlyCases',
    'monthlyFee',
  ] as const;
  const maximums = {
    manualMinutes: 1440,
    assistedMinutes: 1440,
    hourlyCost: 10000,
    monthlyCases: 100000,
    monthlyFee: 100000,
  };
  for (const field of fields) {
    for (const invalid of [-1, Number.NaN, Number.POSITIVE_INFINITY, maximums[field] + 1]) {
      const assumptions = inputs({ [field]: invalid });
      expect(validateValueInputs(assumptions).valid).toBe(false);
      expect(validateValueInputs(assumptions).errors[field]).toBeTruthy();
      expect(() => calculateValue(assumptions)).toThrow(ValueInputError);
    }
    expect(validateValueInputs(inputs({ [field]: maximums[field] })).valid).toBe(true);
  }
  expect(validateValueInputs(inputs({ monthlyCases: 1.5 })).errors.monthlyCases).toContain(
    'whole number',
  );
  expect(
    validateValueInputs({ ...inputs(), hourlyCost: '35' } as unknown as ValueInputs).valid,
  ).toBe(false);
  expect(
    validateValueInputs({ ...inputs(), currency: 'JPY' } as ValueInputs).errors.currency,
  ).toBeTruthy();
  expect(() => roundMoney(Number.NaN)).toThrow(RangeError);
  expect(roundMoney(1.005)).toBe(1.01);
  expect(roundMoney(-1.005)).toBe(-1.01);
});

test('the estimate currency changes the unit, without inventing exchange-rate conversions', () => {
  const usd = calculateValue(inputs({ currency: 'USD' }));
  expect(calculateValue(inputs({ currency: 'EUR' }))).toEqual(usd);
  expect(calculateValue(inputs({ currency: 'GBP' }))).toEqual(usd);
});

test('empty and mixed-currency portfolios keep exposure groups separate', async () => {
  expect(getExposureByCurrency([])).toEqual({});
  expect(getQuickWins([], { now: reference })).toEqual([]);
  expect(getValueMetrics([])).toEqual({
    totalCases: 0,
    activeCases: 0,
    currentAnalyses: 0,
    actionableRecommendations: 0,
    pendingApprovals: 0,
    reviewedReady: 0,
    quickWinCount: 0,
  });
  const cases = await createDemoCases();
  expect(getExposureByCurrency(cases)).toEqual({ USD: 1580 });
  const mixed = clone(cases.slice(0, 3));
  mixed[0].data.currency = 'USD';
  mixed[0].data.amount = '120.50';
  mixed[1].data.currency = 'EUR';
  mixed[1].data.amount = '90.25';
  mixed[2].data.currency = 'GBP';
  mixed[2].data.amount = '70.00';
  expect(getExposureByCurrency(mixed)).toEqual({ USD: 120.5, EUR: 90.25, GBP: 70 });
  mixed[0].status = 'resolved';
  mixed[1].status = 'held';
  expect(getExposureByCurrency(mixed)).toEqual({ EUR: 90.25, GBP: 70 });
  mixed[2].status = 'execution_uncertain';
  expect(getExposureByCurrency(mixed)).toEqual({ EUR: 90.25, GBP: 70 });
  mixed[1].status = 'executed';
  expect(getExposureByCurrency(mixed)).toEqual({ EUR: 90.25, GBP: 70 });
  mixed[2].data.amount = 'not a number';
  expect(() => getExposureByCurrency(mixed)).toThrow(RangeError);
});

test('portfolio metrics count only current analyses and available decisions', async () => {
  const cases = await createDemoCases();
  expect(getValueMetrics(cases)).toEqual({
    totalCases: 10,
    activeCases: 8,
    currentAnalyses: 8,
    actionableRecommendations: 4,
    pendingApprovals: 5,
    reviewedReady: 1,
    quickWinCount: 4,
  });
  expect(
    getQuickWins(cases, { now: reference })
      .map((item) => item.display.customer)
      .sort(),
  ).toEqual(['Amelia Brooks', 'Camille Laurent', 'Léa Dubois', 'Sofia Moreau']);
  const changed = clone(cases);
  changed[0].version += 1;
  expect(isCurrentRun(changed[0])).toBe(false);
  expect(getValueMetrics(changed).currentAnalyses).toBe(7);
  expect(getValueMetrics(changed).pendingApprovals).toBe(4);
  expect(getValueMetrics(changed).quickWinCount).toBe(3);
  changed[2].latest_run_id = 'a_different_run';
  expect(isCurrentRun(changed[2])).toBe(false);
});

test('multiple, inconsistent, incomplete, disallowed, and already attempted outcomes are excluded from quick wins', async () => {
  const cases = await createDemoCases();
  expect(getQuickWins([cases[1], cases[3]], { now: reference })).toEqual([]);
  const base = cases[0];
  for (const state of ['held', 'resolved', 'executed', 'executing', 'execution_uncertain']) {
    expect(getQuickWins([{ ...clone(base), status: state }], { now: reference })).toEqual([]);
  }
  const incomplete = clone(base);
  incomplete.latest_run!.result!.solver!.enumeration_complete = false;
  const nullAction = clone(base);
  nullAction.latest_run!.result!.governance.recommended_action = null;
  const disallowed = clone(base);
  disallowed.data.allowed_actions = ['accept_claim'];
  const extraModel = clone(base);
  extraModel.latest_run!.result!.solver!.models.push(
    clone(extraModel.latest_run!.result!.solver!.models[0]),
  );
  const attempted = clone(base);
  attempted.execution = clone(cases[5].execution);
  expect(
    getQuickWins([incomplete, nullAction, disallowed, extraModel, attempted], { now: reference }),
  ).toEqual([]);
});

test('overdue deadlines lead the queue and currency ties never compare unlike money', async () => {
  const cases = await createDemoCases();
  const ready = [clone(cases[0]), clone(cases[2]), clone(cases[4]), clone(cases[8])];
  ready[1].display.dueAt = '2026-10-01T12:00:00Z';
  ready[3].display.dueAt = null;
  const originalOrder = ready.map((item) => item.id);
  const ordered = getQuickWins(ready, { now: reference });
  expect(ordered[0].display.customer).toBe('Sofia Moreau');
  expect(ordered.at(-1)?.display.customer).toBe('Amelia Brooks');
  expect(ready.map((item) => item.id)).toEqual(originalOrder);
  const equalDue = [clone(cases[0]), clone(cases[2]), clone(cases[8])];
  for (const item of equalDue) item.display.dueAt = '2026-10-07T12:00:00Z';
  equalDue[0].data.amount = '500.00';
  equalDue[1].data.amount = '1000.00';
  equalDue[1].data.currency = 'EUR';
  equalDue[2].data.amount = '10.00';
  const currencyFirst = getQuickWins(equalDue, { currency: 'EUR', now: reference });
  expect(currencyFirst.map((item) => item.data.currency)).toEqual(['EUR', 'USD', 'USD']);
  expect(currencyFirst.slice(1).map((item) => item.data.amount)).toEqual(['500.00', '10.00']);
  expect(() => getQuickWins(ready, { now: 'not a date' })).toThrow(RangeError);
});

test('revenue defense selects evidenced merchant responses without counting accepted claims as defense', async () => {
  const cases = await createDemoCases();
  const defense = getRevenueDefenseCases(cases, { now: reference });
  expect(defense.map((item) => item.display.customer)).toEqual([
    'Amelia Brooks',
    'Camille Laurent',
  ]);
  expect(getExposureByCurrency(defense)).toEqual({ USD: 598 });
  expect(getQuickWins(cases, { now: reference })).toHaveLength(4);
  expect(
    defense.every(
      (item) =>
        (item.review?.action ?? item.latest_run?.result?.governance.recommended_action) ===
        'provide_evidence',
    ),
  ).toBe(true);
  expect(getRevenueDefenseCases([], { now: reference })).toEqual([]);
});

test('defense candidates require verified nonempty evidence rather than cached reasoning alone', async () => {
  const [base] = await createDemoCases();
  const unverified = clone(base);
  for (const evidence of unverified.data.evidence) evidence.verified = false;
  const blank = clone(base);
  for (const evidence of blank.data.evidence) evidence.content = ' \n\t ';
  const absent = clone(base);
  absent.data.evidence = [];
  expect(getQuickWins([unverified, blank, absent], { now: reference })).toHaveLength(3);
  expect(getRevenueDefenseCases([unverified, blank, absent], { now: reference })).toEqual([]);
  const oneVerified = clone(base);
  oneVerified.data.evidence[0].verified = false;
  expect(getRevenueDefenseCases([oneVerified], { now: reference })).toHaveLength(1);
});

test('revenue defense respects the latest human merchant action and ignores other responses', async () => {
  const cases = await createDemoCases();
  expect(getRevenueDefenseCases([cases[2], cases[4]], { now: reference })).toEqual([]);
  const acceptedByReviewer = clone(cases[0]);
  acceptedByReviewer.review = {
    ...clone(cases[4].review!),
    run_id: acceptedByReviewer.latest_run_id!,
    action: 'accept_claim',
  };
  expect(getQuickWins([acceptedByReviewer], { now: reference })).toHaveLength(1);
  expect(getRevenueDefenseCases([acceptedByReviewer], { now: reference })).toEqual([]);
  const heldByReviewer = clone(cases[0]);
  heldByReviewer.review = {
    ...clone(cases[4].review!),
    run_id: heldByReviewer.latest_run_id!,
    action: 'no_action',
  };
  expect(getRevenueDefenseCases([heldByReviewer], { now: reference })).toEqual([]);
  const message = clone(cases[0]);
  message.latest_run!.result!.governance.recommended_action = 'send_message';
  message.data.allowed_actions.push('send_message');
  expect(getQuickWins([message], { now: reference })).toHaveLength(1);
  expect(getRevenueDefenseCases([message], { now: reference })).toEqual([]);
});

test('stale, ambiguous, inconsistent, incomplete, and disallowed defenses are excluded', async () => {
  const cases = await createDemoCases();
  const stale = clone(cases[0]);
  stale.version += 1;
  const superseded = clone(cases[0]);
  superseded.latest_run_id = 'superseded_run';
  const incomplete = clone(cases[0]);
  incomplete.latest_run!.result!.solver!.enumeration_complete = false;
  const disallowed = clone(cases[0]);
  disallowed.data.allowed_actions = ['accept_claim'];
  const ambiguous = clone(cases[1]);
  ambiguous.latest_run!.result!.governance.recommended_action = 'provide_evidence';
  const inconsistent = clone(cases[3]);
  inconsistent.latest_run!.result!.governance.recommended_action = 'provide_evidence';
  expect(
    getRevenueDefenseCases([stale, superseded, incomplete, disallowed, ambiguous, inconsistent], {
      now: reference,
    }),
  ).toEqual([]);
});

test('held, submitted, and previously attempted defenses remain unavailable even after a dry run', async () => {
  const cases = await createDemoCases();
  for (const state of ['held', 'resolved', 'executed', 'executing', 'execution_uncertain']) {
    expect(
      getRevenueDefenseCases([{ ...clone(cases[0]), status: state }], { now: reference }),
    ).toEqual([]);
  }
  const dryRun = clone(cases[0]);
  dryRun.status = 'reviewed';
  dryRun.execution = {
    ...clone(cases[5].execution!),
    run_id: dryRun.latest_run_id!,
    mode: 'dry_run',
  };
  expect(getRevenueDefenseCases([dryRun], { now: reference })).toEqual([]);
  expect(getExposureByCurrency([dryRun])).toEqual({ USD: 249 });
});

test('defense priority preserves deadlines and deterministically orders each original currency', async () => {
  const cases = await createDemoCases();
  const candidates = [clone(cases[0]), clone(cases[8])];
  expect(getRevenueDefenseCases(candidates, { now: reference }).map((item) => item.id)).toEqual(
    getRevenueDefenseCases([...candidates].reverse(), { now: reference }).map((item) => item.id),
  );
  candidates[0].display.dueAt = '2026-10-01T12:00:00Z';
  candidates[1].display.dueAt = '2026-10-10T12:00:00Z';
  candidates[1].data.currency = 'EUR';
  expect(
    getRevenueDefenseCases(candidates, { currency: 'EUR', now: reference }).map(
      (item) => item.display.customer,
    ),
  ).toEqual(['Camille Laurent', 'Amelia Brooks']);
  expect(getExposureByCurrency(getRevenueDefenseCases(candidates, { now: reference }))).toEqual({
    USD: 249,
    EUR: 349,
  });
  candidates[0].display.dueAt = candidates[1].display.dueAt;
  expect(
    getRevenueDefenseCases(candidates, { currency: 'EUR', now: reference })[0].data.currency,
  ).toBe('EUR');
});
