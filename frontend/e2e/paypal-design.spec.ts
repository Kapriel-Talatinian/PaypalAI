import { expect, test, type Page } from '@playwright/test';

async function ready(page: Page) {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Dispute overview', exact: true })).toBeVisible();
  await expect(page.getByTestId('case-grid')).toBeVisible();
}

async function openCamille(page: Page) {
  await page.getByRole('button', { name: "Open Camille Laurent's case", exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Camille Laurent', exact: true })).toBeVisible();
}

test('PayPal typography and colors support a simple overview with optional detail', async ({
  page,
}) => {
  await ready(page);
  const loadedFonts = await page.evaluate(async () => {
    for (const weight of [400, 500, 700]) await document.fonts.load(`${weight} 16px "PayPal Open"`);
    await document.fonts.ready;
    return [...document.fonts]
      .filter((font) => font.family.replaceAll(/["']/g, '') === 'PayPal Open')
      .map((font) => ({ weight: font.weight, status: font.status }));
  });
  expect(loadedFonts).toHaveLength(3);
  expect(loadedFonts.every((font) => font.status === 'loaded')).toBe(true);
  await expect(page.locator('body')).toHaveCSS('font-family', /PayPal Open/);
  await expect(page.getByRole('heading', { name: 'Dispute overview', exact: true })).toHaveCSS(
    'font-family',
    /PayPal Open/,
  );
  await expect(page.getByRole('textbox', { name: 'Search cases', exact: true })).toHaveCSS(
    'font-family',
    /PayPal Open/,
  );
  const next = page.getByTestId('next-value-action');
  await expect(next).toHaveCSS('font-family', /PayPal Open/);
  await expect(next).toHaveCSS('background-color', 'rgb(0, 102, 245)');
  expect(
    await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--navy').trim(),
    ),
  ).toBe('#002991');

  const value = page.getByTestId('value-dashboard');
  await expect(
    value.getByRole('heading', { name: 'Next claim to review', exact: true }),
  ).toBeVisible();
  await expect(
    value.getByRole('heading', { name: 'Revenue under dispute', exact: true }),
  ).toBeVisible();
  await expect(page.getByTestId('value-exposure-USD')).toBeVisible();
  await expect(page.getByTestId('value-exposure-USD')).toContainText('$1,580');
  await expect(
    value.getByText('Unresolved claims, not recovered revenue.', { exact: true }),
  ).toBeVisible();
  await expect(page.getByTestId('roi-net-value')).toBeHidden();
  await expect(page.getByTestId('roi-hours')).toBeHidden();
  await expect(value.locator('.value-case-totals')).not.toHaveAttribute('open', '');
  await expect(value.locator('.value-assumptions')).not.toHaveAttribute('open', '');
  await expect(page.getByTestId('roi-percent')).toBeHidden();
  await expect(value.getByLabel('Manual handling (min / case)', { exact: true })).toBeHidden();
  await expect(page.getByRole('button', { name: 'Response planner', exact: true })).toBeHidden();
  await expect(page.getByRole('button', { name: 'Policy library', exact: true })).toBeHidden();
  const moreTools = page.locator('.more-tools summary');
  await moreTools.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: 'Response planner', exact: true })).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: 'Response planner', exact: true })).toBeHidden();
});

test('the case starts with the response and sources while expert details remain accessible', async ({
  page,
}) => {
  await ready(page);
  await openCamille(page);
  const decision = page.getByRole('region', { name: 'Next response', exact: true });
  await expect(
    decision.getByRole('heading', { name: 'Submit evidence', exact: true }),
  ).toBeVisible();
  await expect(decision).toContainText('Your review is required before a response can be sent.');
  await expect(page.locator('.case-metadata-strip > div')).toHaveCount(2);
  await expect(page.locator('.case-metadata-strip')).toContainText('$249.00');
  await expect(page.locator('.case-metadata-strip')).toContainText('Response due');
  await expect(
    page.getByRole('heading', { name: 'Supporting evidence', exact: true }),
  ).toBeVisible();
  await expect(page.locator('.evidence-card')).toHaveCount(2);
  await expect(page.getByRole('button', { name: 'Review decision', exact: true })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Simulate response', exact: true })).toHaveCount(0);
  await expect(page.getByText('Version 1', { exact: true })).toBeHidden();
  await expect(page.locator('.confidence')).toBeHidden();
  await expect(page.locator('.reasoning-brief')).toBeHidden();
  await expect(
    page.getByRole('button', { name: 'Copy analysis fingerprint', exact: true }),
  ).toBeHidden();

  const caseDetails = page.locator('.case-record-details summary');
  await caseDetails.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByText('Version 1', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Export case', exact: true })).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(page.getByText('Version 1', { exact: true })).toBeHidden();

  const decisionDetails = page.locator('.decision-details summary');
  await decisionDetails.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('.reasoning-brief')).toBeVisible();
  await expect(page.locator('.confidence')).toContainText('Operational confidence');
  await expect(page.locator('.decision-details')).toContainText('not the probability of winning');
  await expect(
    page.getByRole('button', { name: 'Copy analysis fingerprint', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Explore proof', exact: true }).click();
  await expect(page.locator('.proof-canvas')).toBeVisible();
});

test('ambiguous and conflicting cases show their review requirement without an executable recommendation', async ({
  page,
}) => {
  await ready(page);
  for (const scenario of [
    { customer: 'James Carter', heading: 'Human judgment required', outcome: '2 valid outcomes' },
    {
      customer: 'Oliver Bennett',
      heading: 'Resolve the conflict',
      outcome: 'Conflicting evidence',
    },
  ]) {
    await page
      .getByRole('button', { name: `Open ${scenario.customer}'s case`, exact: true })
      .click();
    const decision = page.getByRole('region', { name: 'Next response', exact: true });
    await expect(
      decision.getByRole('heading', { name: scenario.heading, exact: true }),
    ).toBeVisible();
    await expect(decision).toContainText(scenario.outcome);
    await expect(decision).toContainText('Your review is required before a response can be sent.');
    await expect(page.getByRole('button', { name: 'Review decision', exact: true })).toBeEnabled();
    await expect(page.getByRole('button', { name: 'Simulate response', exact: true })).toHaveCount(
      0,
    );
    await expect(page.getByRole('button', { name: 'Submit response', exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'Back to disputes', exact: true }).click();
  }
});

test('the response precedes supporting evidence on a 375px screen with accessible details', async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await ready(page);
  // The grid's customer cell remains available when the desktop action column is virtualized.
  await page.getByTestId('case-grid').getByText('Camille Laurent', { exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Camille Laurent', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Review decision', exact: true })).toBeInViewport();
  const decisionBox = await page.locator('.decision-card').boundingBox();
  const evidenceBox = await page.locator('.evidence-section').boundingBox();
  expect(decisionBox).not.toBeNull();
  expect(evidenceBox).not.toBeNull();
  expect(decisionBox!.y).toBeLessThan(evidenceBox!.y);
  for (const summary of ['.case-record-details summary', '.decision-details summary'])
    await page.locator(summary).click();
  await expect(page.getByText('Version 1', { exact: true })).toBeVisible();
  await expect(page.locator('.confidence')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
    true,
  );
});
