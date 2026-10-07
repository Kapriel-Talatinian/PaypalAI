import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { DEMO_POLICY } from '../src/data/demo';

async function ready(page: Page) {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Dispute overview', exact: true })).toBeVisible();
  await expect(
    page.getByTestId('case-grid').getByText('Camille Laurent', { exact: true }),
  ).toBeVisible();
  await expect(page.getByText('Preparing your workspace', { exact: true })).toHaveCount(0);
}
async function openCamille(page: Page) {
  await ready(page);
  await page.getByRole('button', { name: "Open Camille Laurent's case", exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Camille Laurent', exact: true })).toBeVisible();
}

test('the dispute register supports status filters, search, and CSV export', async ({ page }) => {
  await ready(page);
  await expect(page.locator('.table-footer')).toContainText('Showing 6 of 10 cases');
  await page.getByRole('button', { name: /^Needs review/ }).click();
  await expect(page.locator('.table-footer')).toContainText('Showing 5 of 5 cases');
  await expect(
    page.getByTestId('case-grid').getByText('Needs review', { exact: true }),
  ).toHaveCount(5);
  await page.getByRole('button', { name: /^Unprocessed/ }).click();
  await expect(page.locator('.table-footer')).toContainText('Showing 2 of 2 cases');
  await expect(
    page.getByTestId('case-grid').getByText('Emma Wilson', { exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: /^All cases/ }).click();
  await page.getByRole('textbox', { name: 'Search cases', exact: true }).fill('James Carter');
  await expect(page.locator('.table-footer')).toContainText('Showing 1 of 1 cases');
  await expect(
    page.getByTestId('case-grid').getByText('James Carter', { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByTestId('case-grid').getByText('Camille Laurent', { exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole('textbox', { name: 'Search cases', exact: true })
    .fill('no matching synthetic customer');
  await expect(page.getByText('No cases match this view.', { exact: true })).toBeVisible();
  await page.getByRole('textbox', { name: 'Search cases', exact: true }).fill('');
  await page.getByRole('button', { name: 'All disputes', exact: true }).click();
  await expect(page.locator('.table-footer')).toContainText('Showing 10 of 10 cases');
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export cases as CSV', exact: true }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('disputeflow-cases.csv');
  const csv = await readFile((await download.path())!, 'utf8');
  expect(csv).toContain('Camille Laurent');
  expect(csv).toContain('James Carter');
  expect(csv.split('\n')).toHaveLength(11);
});

test('new verified tracking evidence changes the recommendation and records review and dry run', async ({
  page,
}) => {
  const externalRequests: string[] = [];
  page.on('request', (request) => {
    if (/paypal\.com|openai\.com|\/v1\//.test(request.url())) externalRequests.push(request.url());
  });
  await openCamille(page);
  await expect(
    page.locator('.decision-card').getByRole('heading', { name: 'Submit evidence', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Add evidence', exact: true }).first().click();
  const evidenceDialog = page.getByRole('dialog', { name: 'Add new evidence', exact: true });
  await evidenceDialog.getByRole('combobox', { name: /^Evidence type/ }).selectOption('tracking');
  await evidenceDialog
    .getByLabel('Evidence content', { exact: true })
    .fill(
      'Synthetic carrier correction: the original scan belongs to a different delivery address.',
    );
  await evidenceDialog
    .getByLabel('I have verified the source of this evidence.', { exact: true })
    .check();
  await evidenceDialog
    .getByRole('checkbox', { name: /Demo scenario: the delivery tracking is invalid/ })
    .check();
  await evidenceDialog.getByRole('button', { name: 'Add evidence', exact: true }).click();
  await expect(evidenceDialog).toHaveCount(0);
  await page.locator('.case-record-details summary').click();
  await expect(page.getByText('Version 2', { exact: true })).toBeVisible();
  await expect(
    page
      .locator('.decision-card')
      .getByRole('heading', { name: 'Ready for analysis', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Analyze case', exact: true }).click();
  await expect(page.locator('.analysis-progress')).toBeVisible();
  await expect(
    page.locator('.decision-card').getByRole('heading', { name: 'Accept claim', exact: true }),
  ).toBeVisible();
  await expect(page.getByText('One consistent outcome', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Review decision', exact: true })).toBeEnabled();

  await page.getByRole('button', { name: 'Review decision', exact: true }).click();
  const reviewDialog = page.getByRole('dialog', { name: 'Record your decision', exact: true });
  await expect(reviewDialog.getByRole('radio').first()).toBeChecked();
  await reviewDialog
    .getByLabel('Review note', { exact: true })
    .fill(
      'Verified the carrier correction and policy exception. Approve acceptance of the synthetic claim.',
    );
  await reviewDialog.getByRole('button', { name: 'Record decision', exact: true }).click();
  await expect(reviewDialog).toHaveCount(0);
  await expect(page.locator('.case-kicker')).toContainText('Approved');
  await expect(page.getByRole('button', { name: 'Simulate response', exact: true })).toBeEnabled();

  await page.getByRole('button', { name: 'Simulate response', exact: true }).click();
  const executeDialog = page.getByRole('dialog', { name: 'Simulate your response', exact: true });
  await expect(executeDialog).toContainText('No message or payment is sent to PayPal.');
  await executeDialog
    .getByLabel('Response note', { exact: true })
    .fill('Reviewed synthetic claim acceptance. Demonstration only.');
  await executeDialog.getByRole('button', { name: 'Run simulation', exact: true }).click();
  await expect(executeDialog).toHaveCount(0);
  await expect(page.getByText('Simulation complete', { exact: true })).toBeVisible();
  await page.locator('.execution-record summary').click();
  await expect(page.locator('.journal-note')).toBeVisible();
  await expect(page.locator('.journal-note')).toContainText('succeeded');
  await expect(page.locator('.journal-note')).toContainText('dry run');
  await page
    .getByRole('navigation', { name: 'Case sections', exact: true })
    .getByRole('button', { name: 'Audit trail', exact: true })
    .click();
  await expect(page.getByText('Hash chain verified', { exact: true })).toBeVisible();
  await expect(page.getByText('7 recorded events', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Evidence updated', exact: true })).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Human review recorded', exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Action completed', exact: true })).toBeVisible();

  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export case', exact: true }).click();
  const download = await downloadPromise;
  const exported = JSON.parse(await readFile((await download.path())!, 'utf8'));
  expect(exported.case.version).toBe(2);
  expect(exported.case.review.action).toBe('accept_claim');
  expect(exported.case.execution.mode).toBe('dry_run');
  expect(exported.case.execution.response.external_request_sent).toBe(false);
  expect(exported.audit.verified).toBe(true);
  expect(
    exported.run.result.knowledge_base.facts.some(
      (fact: { literal: { name: string } }) => fact.literal.name === 'tracking_invalid',
    ),
  ).toBe(true);
  expect(externalRequests).toEqual([]);
});

test('a new synthetic dispute is created and analyzed from the customer statement', async ({
  page,
}) => {
  await ready(page);
  await page.getByRole('button', { name: 'Add dispute', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Add a dispute', exact: true });
  await dialog.getByLabel('Customer name', { exact: true }).fill('Alex Morgan');
  await dialog.getByLabel('Disputed amount', { exact: true }).fill('175.00');
  await dialog.getByRole('combobox', { name: /^Currency/ }).selectOption('EUR');
  await dialog.getByRole('combobox', { name: /^Reason/ }).selectOption('not_as_described');
  await dialog
    .getByLabel('Customer statement', { exact: true })
    .fill('The synthetic order arrived with a finish different from the listing photographs.');
  await dialog.getByRole('button', { name: 'Create case', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Alex Morgan', exact: true })).toBeVisible();
  await expect(page.locator('.case-metadata-strip')).toContainText('€175.00');
  await page.locator('.case-record-details summary').click();
  await expect(page.getByText('Version 1', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Analyze case', exact: true }).click();
  await expect(
    page.locator('.decision-card').getByRole('heading', { name: 'Accept claim', exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Review decision', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Back to disputes', exact: true }).click();
  await expect(page.locator('.table-footer')).toContainText('Showing 6 of 11 cases');
  await expect(
    page.getByTestId('case-grid').getByText('Alex Morgan', { exact: true }),
  ).toBeVisible();
});

test('verifying a carrier source updates the evidence revision before analysis', async ({
  page,
}) => {
  await ready(page);
  await page.getByRole('button', { name: 'All disputes', exact: true }).click();
  await page.getByRole('button', { name: "Open Emma Wilson's case", exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Emma Wilson', exact: true })).toBeVisible();
  await expect(page.getByText('Unverified source', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Verify source', exact: true }).click();
  await page.locator('.case-record-details summary').click();
  await expect(page.getByText('Version 2', { exact: true })).toBeVisible();
  await expect(page.getByText('Unverified source', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Verified source', { exact: true })).toHaveCount(2);
  await page.getByRole('button', { name: 'Analyze case', exact: true }).click();
  await expect(
    page.locator('.decision-card').getByRole('heading', { name: 'Submit evidence', exact: true }),
  ).toBeVisible();
  await page
    .getByRole('navigation', { name: 'Case sections', exact: true })
    .getByRole('button', { name: 'Audit trail', exact: true })
    .click();
  await expect(page.getByText('Hash chain verified', { exact: true })).toBeVisible();
  await expect(page.locator('.audit-events')).toContainText('evidence_verification');
});

test('the response planner opens a selected scheduled case', async ({ page }) => {
  await ready(page);
  await page.locator('.more-tools summary').click();
  await page.getByRole('button', { name: 'Response planner', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Response planner', exact: true })).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Keep every deadline in view.', exact: true }),
  ).toBeVisible();
  const scheduler = page.getByTestId('deadline-scheduler');
  await expect(scheduler).toBeVisible();
  await expect(scheduler.getByText('Camille Laurent', { exact: true })).toBeVisible();
  await scheduler.getByText('Camille Laurent', { exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Camille Laurent', exact: true })).toBeVisible();
  await expect(page.locator('.case-kicker')).toContainText('DEMO-DF-1042');
});

test('the default API connection uses the same-origin proxy and loads full policy text', async ({
  page,
}) => {
  const calls: string[] = [];
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    calls.push(path);
    let body: unknown;
    if (path === '/api/ready')
      body = { status: 'ready', execution_mode: 'dry_run', llm_provider: 'demo' };
    else if (path === '/api/v1/metrics')
      body = { cases: {}, runs: {}, executions: {}, webhooks: {} };
    else if (path === '/api/v1/policies')
      body = {
        items: [
          {
            id: DEMO_POLICY.id,
            title: DEMO_POLICY.title,
            version: DEMO_POLICY.version,
            source_url: DEMO_POLICY.source_url,
            synthetic: true,
            sha256: 'test-source-hash',
          },
        ],
      };
    else if (path === '/api/v1/policies/demo_policy') body = DEMO_POLICY;
    else if (path === '/api/v1/disputes' || path === '/api/v1/reviews')
      body = { items: [], total: 0, offset: 0, limit: 200 };
    else {
      await route.fulfill({ status: 404, json: { detail: `Unexpected test API path: ${path}` } });
      return;
    }
    await route.fulfill({ status: 200, json: body });
  });
  await ready(page);
  await page.getByRole('button', { name: 'Connect API', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Connect your workspace', exact: true });
  await expect(dialog.getByRole('textbox', { name: /^API address/ })).toHaveValue('/api');
  await dialog.getByLabel('Workspace key', { exact: true }).fill('synthetic-service-key');
  await dialog.getByRole('button', { name: 'Connect API', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByText('API connected', { exact: true })).toBeVisible();
  expect(calls).toContain('/api/ready');
  expect(calls).toContain('/api/v1/disputes');
  expect(calls).toContain('/api/v1/policies/demo_policy');
  await page.locator('.more-tools summary').click();
  await page.getByRole('button', { name: 'Policy library', exact: true }).click();
  await expect(
    page.getByText(DEMO_POLICY.sections[1].children[1].text, { exact: true }),
  ).toBeVisible();
  expect(await page.evaluate(() => JSON.stringify({ localStorage, sessionStorage }))).not.toContain(
    'synthetic-service-key',
  );
});
