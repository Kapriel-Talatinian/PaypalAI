import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

async function openCaseTotals(page: Page) {
  const details = page.getByTestId('value-dashboard').locator('.value-case-totals');
  if ((await details.getAttribute('open')) === null) await details.locator('summary').click();
}

async function expectCount(page: Page, testId: string, expected: number) {
  await openCaseTotals(page);
  await expect
    .poll(async () => {
      const text = await page.getByTestId(testId).innerText();
      const value = text.match(/\d[\d,]*/)?.[0];
      return value === undefined ? Number.NaN : Number(value.replaceAll(',', ''));
    })
    .toBe(expected);
}

async function ready(page: Page) {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Dispute overview', exact: true })).toBeVisible();
  await expect(page.getByTestId('value-dashboard')).toBeVisible();
}

async function editAssumptions(page: Page) {
  const details = page.getByTestId('value-dashboard').locator('.value-assumptions');
  if ((await details.getAttribute('open')) === null) await details.locator('summary').click();
}

test('the overview shows unresolved revenue first and keeps labor estimates optional', async ({
  page,
}) => {
  await ready(page);
  const panel = page.getByTestId('value-dashboard');
  await expect(
    panel.getByRole('heading', { name: 'Revenue under dispute', exact: true }),
  ).toBeVisible();
  await expect(page.getByTestId('value-exposure-USD')).toBeVisible();
  await expect(page.getByTestId('value-exposure-USD')).toContainText('$1,580');
  await expect(
    panel.getByText('Unresolved claims, not recovered revenue.', { exact: true }),
  ).toBeVisible();
  await expect(
    panel.getByRole('heading', { name: 'Next claim to review', exact: true }),
  ).toBeVisible();
  await expect(panel.getByText('Amelia Brooks', { exact: true })).toBeVisible();
  await expect(page.getByTestId('roi-net-value')).toBeHidden();
  await expect(page.getByTestId('roi-hours')).toBeHidden();
  await expect(page.getByTestId('roi-percent')).toBeHidden();
  await expect(panel.getByLabel('Manual handling (min / case)', { exact: true })).toBeHidden();

  await editAssumptions(page);
  await expect(panel).toContainText('Projected monthly value');
  await expect(panel).toContainText('Illustrative inputs');
  await expect(panel).toContainText('No dispute recoveries included.');
  // 100 cases × (25 − 5) minutes / 60 × $35, less the illustrative $99 monthly cost.
  await expect(page.getByTestId('roi-net-value')).toBeVisible();
  await expect(page.getByTestId('roi-net-value')).toContainText('$1,067.67');
  await expect(page.getByTestId('roi-percent')).toContainText('1,078%');
  await expect(page.getByTestId('roi-hours')).toContainText('33.3');
  await expect(page.getByTestId('roi-break-even')).toContainText('9');
  await expectCount(page, 'value-reviewed-ready', 1);
  await expectCount(page, 'value-pending-approvals', 5);
  await expect(panel).not.toContainText(/NaN|Infinity/);
});

test('editing all operating assumptions updates monthly time, money, and break-even', async ({
  page,
}) => {
  await ready(page);
  await editAssumptions(page);
  const panel = page.getByTestId('value-dashboard');
  await panel.getByLabel('Manual handling (min / case)', { exact: true }).fill('35');
  await panel.getByLabel('Assisted handling (min / case)', { exact: true }).fill('20');
  await panel.getByLabel(/^Hourly team cost/).fill('40');
  await panel.getByLabel('Cases per month', { exact: true }).fill('60');
  await panel.getByLabel(/^Monthly software cost/).fill('200');
  // 60 × 15 minutes = 15 hours; $600 gross time value − $200 cost = $400 net.
  await expect(page.getByTestId('roi-hours')).toContainText('15');
  await expect(page.getByTestId('roi-net-value')).toContainText('$400.00');
  await expect(page.getByTestId('roi-percent')).toContainText('200%');
  await expect(page.getByTestId('roi-break-even')).toContainText('20');
  await panel.getByRole('combobox', { name: 'Scenario currency', exact: true }).selectOption('EUR');
  await expect(page.getByTestId('roi-net-value')).toContainText('€400.00');
  // Scenario currency describes the labor-cost inputs, without converting dispute exposure.
  await openCaseTotals(page);
  await expect(page.getByTestId('value-exposure-USD')).toContainText('$1,580');
  await expectCount(page, 'value-quick-wins', 4);

  // Case inspection and workspace navigation must preserve the team's edited scenario.
  await page.getByTestId('next-value-action').click();
  await expect(page.getByRole('heading', { name: 'Amelia Brooks', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Back to disputes', exact: true }).click();
  await expect(page.getByTestId('roi-net-value')).toBeHidden();
  await editAssumptions(page);
  await expect(page.getByTestId('roi-net-value')).toContainText('€400.00');
  await expect(page.getByTestId('roi-percent')).toContainText('200%');
  await expect(panel.getByLabel('Manual handling (min / case)', { exact: true })).toHaveValue('35');
  await expect(panel.getByLabel('Assisted handling (min / case)', { exact: true })).toHaveValue(
    '20',
  );
  await expect(panel.getByLabel(/^Hourly team cost/)).toHaveValue('40');
  await expect(panel.getByLabel('Cases per month', { exact: true })).toHaveValue('60');
  await expect(panel.getByLabel(/^Monthly software cost/)).toHaveValue('200');
  await expect(panel.getByRole('combobox', { name: 'Scenario currency', exact: true })).toHaveValue(
    'EUR',
  );

  const navigation = page.getByRole('navigation', { name: 'Workspace navigation', exact: true });
  await navigation.getByRole('button', { name: /^Review queue/ }).click();
  await expect(page.getByRole('heading', { name: 'Review queue', exact: true })).toBeVisible();
  await navigation.getByRole('button', { name: 'Overview', exact: true }).click();
  await editAssumptions(page);
  await expect(page.getByTestId('roi-net-value')).toContainText('€400.00');
  await expect(page.getByTestId('roi-percent')).toContainText('200%');
  await expect(page.getByTestId('roi-hours')).toContainText('15');
  await expect(page.getByTestId('roi-break-even')).toContainText('20');
  await editAssumptions(page);
  await expect(panel.getByLabel('Manual handling (min / case)', { exact: true })).toHaveValue('35');
  await expect(panel.getByLabel('Assisted handling (min / case)', { exact: true })).toHaveValue(
    '20',
  );
  await expect(panel.getByLabel(/^Hourly team cost/)).toHaveValue('40');
  await expect(panel.getByLabel('Cases per month', { exact: true })).toHaveValue('60');
  await expect(panel.getByLabel(/^Monthly software cost/)).toHaveValue('200');
  await expect(panel.getByRole('combobox', { name: 'Scenario currency', exact: true })).toHaveValue(
    'EUR',
  );
});

test('cost overruns and zero denominators retain honest finite projections', async ({ page }) => {
  await ready(page);
  await editAssumptions(page);
  const panel = page.getByTestId('value-dashboard');
  const fee = panel.getByLabel(/^Monthly software cost/);
  await fee.fill('2000');
  await expect(page.getByTestId('roi-net-value')).toContainText('833.33');
  await expect(page.getByTestId('roi-net-value')).toContainText(/[-−]/);
  await expect(page.getByTestId('roi-percent')).toContainText(/[-−]42%/);

  await fee.fill('0');
  await expect(page.getByTestId('roi-net-value')).toContainText('$1,166.67');
  await expect(page.getByTestId('roi-percent')).toContainText('—');
  await expect(panel).toContainText('No monthly cost');

  await fee.fill('99');
  await panel.getByLabel('Assisted handling (min / case)', { exact: true }).fill('25');
  await expect(page.getByTestId('roi-hours')).toContainText('0');
  await expect(page.getByTestId('roi-net-value')).toContainText('99.00');
  await expect(page.getByTestId('roi-percent')).toContainText(/[-−]100%/);
  await expect(page.getByTestId('roi-break-even')).toContainText('Not reached');

  // More assisted work than manual work represents an actual negative time-value estimate.
  await panel.getByLabel('Assisted handling (min / case)', { exact: true }).fill('40');
  await expect(page.getByTestId('roi-hours')).toContainText(/[-−]25/);
  await expect(page.getByTestId('roi-net-value')).toContainText('974.00');
  await expect(page.getByTestId('roi-percent')).toContainText(/[-−]984%/);
  await expect(page.getByTestId('roi-break-even')).toContainText('Not reached');
  await expect(panel).not.toContainText(/NaN|Infinity/);

  await panel.getByLabel('Manual handling (min / case)', { exact: true }).fill('');
  await expect(page.getByTestId('roi-net-value')).toContainText('—');
  await expect(page.getByTestId('roi-percent')).toContainText('—');
  await expect(panel).not.toContainText(/NaN|Infinity/);
});

test('the next claim prioritizes a verified merchant evidence response for review', async ({
  page,
}) => {
  await ready(page);
  const panel = page.getByTestId('value-dashboard');
  await expect(panel.getByText('Amelia Brooks', { exact: true })).toBeVisible();
  await expect(panel.getByText('Submit evidence', { exact: true })).toBeVisible();
  await expect(panel).toContainText('$349.00');
  const next = page.getByTestId('next-value-action');
  await expect(next).toHaveAccessibleName('Review next response');
  await next.click();
  await expect(page.getByRole('heading', { name: 'Amelia Brooks', exact: true })).toBeVisible();
  await expect(page.locator('.case-kicker')).toContainText('DEMO-DF-1034');
  await expect(
    page.locator('.decision-card').getByRole('heading', { name: 'Submit evidence', exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Review decision', exact: true })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Simulate response', exact: true })).toHaveCount(0);
});

test('dispute exposure remains separated by currency after adding a euro case', async ({
  page,
}) => {
  await ready(page);
  await page.getByRole('button', { name: 'Add dispute', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Add a dispute', exact: true });
  await dialog.getByLabel('Customer name', { exact: true }).fill('Euro exposure check');
  await dialog.getByLabel('Disputed amount', { exact: true }).fill('175.00');
  await dialog.getByRole('combobox', { name: /^Currency/ }).selectOption('EUR');
  await dialog
    .getByLabel('Customer statement', { exact: true })
    .fill('A synthetic order has not arrived. This record is denominated in euros.');
  await dialog.getByRole('button', { name: 'Create case', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Euro exposure check', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Back to disputes', exact: true }).click();
  await expect(page.getByTestId('value-exposure-USD')).toBeVisible();
  await expect(page.getByTestId('value-exposure-USD')).toContainText('$1,580');
  await expect(page.getByTestId('value-exposure-EUR')).toContainText('€175');
  await expect(page.getByTestId('value-exposure-USD')).not.toContainText('$1,755');
  await editAssumptions(page);
  await expect(page.getByTestId('roi-net-value')).toContainText('$1,067.67');
});

test('recording a review and dry run updates response readiness without inventing earnings', async ({
  page,
}) => {
  await ready(page);
  await expectCount(page, 'value-reviewed-ready', 1);
  await expectCount(page, 'value-pending-approvals', 5);
  await page.getByRole('button', { name: "Open Camille Laurent's case", exact: true }).click();
  await page.getByRole('button', { name: 'Review decision', exact: true }).click();
  let dialog = page.getByRole('dialog', { name: 'Record your decision', exact: true });
  await dialog
    .getByLabel('Review note', { exact: true })
    .fill('Verified the synthetic delivery evidence and the exact policy priority.');
  await dialog.getByRole('button', { name: 'Record decision', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await page.getByRole('button', { name: 'Back to disputes', exact: true }).click();
  await expectCount(page, 'value-reviewed-ready', 2);
  await expectCount(page, 'value-pending-approvals', 4);
  await expectCount(page, 'value-quick-wins', 4);

  await page.getByRole('button', { name: "Open Léa Dubois's case", exact: true }).click();
  await page.getByRole('button', { name: 'Simulate response', exact: true }).click();
  dialog = page.getByRole('dialog', { name: 'Simulate your response', exact: true });
  await dialog
    .getByLabel('Response note', { exact: true })
    .fill('Synthetic verified buyer statement supporting the reviewed acceptance.');
  await dialog.getByRole('button', { name: 'Run simulation', exact: true }).click();
  await expect(page.getByText('Simulation complete', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Back to disputes', exact: true }).click();
  await expectCount(page, 'value-reviewed-ready', 1);
  await expectCount(page, 'value-pending-approvals', 4);
  await expectCount(page, 'value-quick-wins', 3);
  await expect(page.getByTestId('value-exposure-USD')).toContainText('$1,580');
  await expect(
    page
      .getByTestId('value-dashboard')
      .getByText('Unresolved claims, not recovered revenue.', { exact: true }),
  ).toBeVisible();
  await editAssumptions(page);
  await expect(page.getByTestId('roi-net-value')).toContainText('$1,067.67');
  await expect(page.getByTestId('value-dashboard')).toContainText(
    'No dispute recoveries included.',
  );
});

test('merchant evidence responses keep exposure unchanged and preserve legitimate acceptance', async ({
  page,
}) => {
  await ready(page);
  const panel = page.getByTestId('value-dashboard');
  for (const customer of ['Amelia Brooks', 'Camille Laurent']) {
    await expect(panel.getByText(customer, { exact: true })).toBeVisible();
    await expect(page.getByTestId('next-value-action')).toHaveAccessibleName(
      'Review next response',
    );
    await page.getByTestId('next-value-action').click();
    await expect(page.getByRole('heading', { name: customer, exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Review decision', exact: true }).click();
    const review = page.getByRole('dialog', { name: 'Record your decision', exact: true });
    await review
      .getByLabel('Review note', { exact: true })
      .fill('Checked the verified synthetic delivery source and exact merchant evidence policy.');
    await review.getByRole('button', { name: 'Record decision', exact: true }).click();
    await expect(review).toHaveCount(0);
    await page.getByRole('button', { name: 'Simulate response', exact: true }).click();
    const submit = page.getByRole('dialog', { name: 'Simulate your response', exact: true });
    await expect(submit.getByLabel('Evidence to submit', { exact: true })).toHaveValue(
      /Carrier delivery scan confirms delivery to the order address/,
    );
    await expect(submit).toContainText('No message or payment is sent to PayPal.');
    await submit.getByRole('button', { name: 'Run simulation', exact: true }).click();
    await expect(page.getByText('Simulation complete', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Back to disputes', exact: true }).click();
    await expect(page.getByTestId('value-exposure-USD')).toBeVisible();
    await expect(page.getByTestId('value-exposure-USD')).toContainText('$1,580');
    await expect(page.getByTestId('roi-net-value')).toBeHidden();
  }
  await expect(panel.getByText('Léa Dubois', { exact: true })).toBeVisible();
  await expect(panel.getByText('Accept claim', { exact: true })).toBeVisible();
  await expect(page.getByTestId('next-value-action')).toHaveAccessibleName('Open next case');
  await page.getByTestId('next-value-action').click();
  await expect(page.getByRole('heading', { name: 'Léa Dubois', exact: true })).toBeVisible();
  await expect(
    page.locator('.decision-card').getByRole('heading', { name: 'Accept claim', exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Simulate response', exact: true })).toBeEnabled();
});

test('the value overview and editable assumptions fit a 375px viewport', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await ready(page);
  const panel = page.getByTestId('value-dashboard');
  await expect(page.getByTestId('value-exposure-USD')).toBeInViewport();
  await expect(page.getByTestId('roi-net-value')).toBeHidden();
  await editAssumptions(page);
  await expect(panel.getByLabel(/^Monthly software cost/)).toBeVisible();
  await expect(page.getByTestId('next-value-action')).toBeVisible();
  const geometry = await panel.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return {
      left: rect.left,
      right: rect.right,
      width: rect.width,
      documentWidth: document.documentElement.scrollWidth,
      viewportWidth: window.innerWidth,
    };
  });
  expect(geometry.left, JSON.stringify(geometry)).toBeGreaterThanOrEqual(-1);
  expect(geometry.right, JSON.stringify(geometry)).toBeLessThanOrEqual(geometry.viewportWidth + 1);
  expect(geometry.width, JSON.stringify(geometry)).toBeLessThanOrEqual(375);
  expect(geometry.documentWidth, JSON.stringify(geometry)).toBeLessThanOrEqual(
    geometry.viewportWidth + 1,
  );
});
