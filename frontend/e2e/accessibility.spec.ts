import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

async function ready(page: Page) {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Dispute overview', exact: true })).toBeVisible();
  await expect(page.getByTestId('case-grid')).toBeVisible();
}

async function openProof(page: Page) {
  await page.getByRole('button', { name: "Open Camille Laurent's case", exact: true }).click();
  await page
    .getByRole('navigation', { name: 'Case sections' })
    .getByRole('button', { name: 'Reasoning graph', exact: true })
    .click();
  await expect(page.locator('.proof-canvas')).toBeVisible();
}

test('connection dialog traps keyboard focus and Escape returns to its trigger', async ({
  page,
}) => {
  await ready(page);
  const trigger = page.getByRole('button', { name: 'Connect API', exact: true });
  await trigger.focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Connect your workspace' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Close dialog' })).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(dialog.getByRole('button', { name: 'Connect API', exact: true })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(dialog.getByRole('button', { name: 'Close dialog' })).toBeFocused();
  for (let index = 0; index < 14; index++) {
    await page.keyboard.press('Tab');
    expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true);
  }
  await page.keyboard.press('Control+k');
  expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true);
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
});

test('new dispute form preserves native required validation and cancel restores focus', async ({
  page,
}) => {
  await ready(page);
  const trigger = page.getByRole('button', { name: 'Add dispute', exact: true });
  await trigger.focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Add a dispute' });
  await dialog.getByRole('button', { name: 'Create case', exact: true }).click();
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('textbox', { name: 'Customer name', exact: true })).toBeFocused();
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
});

test('proof nodes work with the keyboard and expose exact evidence and policy provenance', async ({
  page,
}) => {
  await ready(page);
  await openProof(page);
  const rule = page.getByRole('button', { name: /^Verified delivery exception\. APPLIED RULE\./ });
  await rule.focus();
  await page.keyboard.press('Enter');
  await expect(rule).toHaveAttribute('aria-pressed', 'true');
  const inspector = page.locator('.proof-inspector');
  await expect(inspector.locator('.proof-node-id')).toHaveText('rule:seller_delivery');
  await expect(inspector.locator('.proof-quote blockquote').last()).toHaveText(
    'In this synthetic demo, a verified delivery_verified fact normally supports the explicit opposite of decision_accept_claim, unless tracking_invalid is established.',
  );
  await expect(inspector).toContainText('2026-10-demo');
  const evidence = page.getByRole('button', { name: /^Delivery confirmed\. VERIFIED SOURCE\./ });
  await evidence.focus();
  await page.keyboard.press('Space');
  await expect(inspector.locator('.proof-evidence-content')).toContainText(
    'Carrier delivery scan confirms delivery to the order address.',
  );
  await expect(inspector.locator('.proof-evidence-content')).toContainText(
    'FACT:delivery_verified',
  );
  await page.getByRole('button', { name: 'Browse sources', exact: true }).click();
  await page
    .getByRole('textbox', { name: 'Search evidence and policy sources' })
    .fill('carrier_record');
  await expect(page.locator('.proof-source-results details')).toHaveCount(1);
  await page.locator('.proof-source-results summary').click();
  await expect(page.locator('.proof-source-results blockquote')).toContainText(
    'Carrier delivery scan confirms delivery to the order address.',
  );
});

test('switching a stable model updates applied rules and conclusions', async ({ page }) => {
  await ready(page);
  await page.getByText('James Carter', { exact: true }).click();
  await page
    .getByRole('navigation', { name: 'Case sections' })
    .getByRole('button', { name: 'Reasoning graph', exact: true })
    .click();
  const selector = page.locator('.proof-model-select select');
  await expect(selector).toBeVisible();
  await expect(selector.locator('option')).toHaveCount(2);
  const firstRules = await page.locator('.proof-node-applied .proof-node-title').allTextContents();
  const firstConclusions = await page
    .locator('.proof-node-conclusion .proof-node-title')
    .allTextContents();
  await selector.selectOption({ index: 1 });
  const secondRules = await page.locator('.proof-node-applied .proof-node-title').allTextContents();
  const secondConclusions = await page
    .locator('.proof-node-conclusion .proof-node-title')
    .allTextContents();
  expect(secondRules).not.toEqual(firstRules);
  expect(secondConclusions).not.toEqual(firstConclusions);
  await expect(page.locator('.proof-inspector')).toContainText('selected stable model');
});

test('audit event details expose hashes and original event data', async ({ page }) => {
  await ready(page);
  await page.getByRole('button', { name: "Open Camille Laurent's case", exact: true }).click();
  await page
    .getByRole('navigation', { name: 'Case sections' })
    .getByRole('button', { name: 'Audit trail', exact: true })
    .click();
  await expect(page.locator('.audit-verification')).toHaveText('Hash chain verified');
  await page.locator('.audit-event-details').first().locator('summary').click();
  const record = page.locator('.audit-event-record').first();
  await expect(record.locator('.audit-full-hash').first()).toHaveText(/^[a-f0-9]{64}$/);
  await expect(record.locator('.audit-full-hash').nth(1)).toHaveText('0'.repeat(64));
  await expect(record.locator('pre')).toContainText('synthetic');
  await expect(page.locator('.audit-summary')).toContainText('Europe / Paris');
});

test('375px layout keeps navigation and dialogs accessible without page overflow', async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await ready(page);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
  ).toBe(true);
  const menu = page.getByRole('button', { name: 'Open navigation' });
  await menu.focus();
  const closedNavigationCanTakeFocus = await page.locator('.sidebar').evaluate((element) => {
    element.querySelector<HTMLButtonElement>('nav button')?.focus();
    return element.contains(document.activeElement);
  });
  expect(closedNavigationCanTakeFocus).toBe(false);
  await page.keyboard.press('Enter');
  const sidebar = page.locator('.sidebar');
  await expect(sidebar).toHaveClass(/sidebar-open/);
  const cases = page
    .getByRole('navigation', { name: 'Workspace navigation' })
    .getByRole('button', { name: 'All disputes', exact: true });
  await cases.focus();
  await page.keyboard.press('Escape');
  await expect(sidebar).not.toHaveClass(/sidebar-open/);
  await expect(menu).toBeFocused();
  await page.keyboard.press('Enter');
  await cases.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'All disputes', exact: true })).toBeVisible();
  await expect(sidebar).not.toHaveClass(/sidebar-open/);
  await page.getByRole('button', { name: 'Add dispute', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Add a dispute' })).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
  ).toBe(true);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toBeHidden();
  await menu.focus();
  for (let index = 0; index < 12; index++) {
    await page.keyboard.press('Tab');
    const focusIsOnscreen = await page.evaluate(() => {
      const element = document.activeElement;
      if (!element || element === document.body) return true;
      const box = element.getBoundingClientRect();
      return box.width > 0 && box.height > 0 && box.right > 0 && box.left < innerWidth;
    });
    expect(focusIsOnscreen).toBe(true);
  }
});

test('mobile reasoning and audit panels keep their overflow inside the panel', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await ready(page);
  await page.getByTestId('case-grid').getByText('Camille Laurent', { exact: true }).click();
  const sections = page.getByRole('navigation', { name: 'Case sections' });
  await sections.getByRole('button', { name: 'Reasoning graph', exact: true }).click();
  await expect(page.locator('.proof-canvas')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
    true,
  );
  await page.getByRole('button', { name: 'Browse sources', exact: true }).click();
  await page.getByRole('textbox', { name: 'Search evidence and policy sources' }).fill('synthetic');
  await page.locator('.proof-source-results summary').first().click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
    true,
  );
  await sections.getByRole('button', { name: 'Audit trail', exact: true }).click();
  await page.locator('.audit-event-details').first().locator('summary').click();
  await expect(page.locator('.audit-event-record').first()).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
    true,
  );
});
