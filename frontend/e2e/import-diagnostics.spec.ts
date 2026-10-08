import { expect, test, type Page } from '@playwright/test';
import { clone, createDemoCases } from '../src/data/demo';
import { normalizeCase } from '../src/lib/cases';
import { money } from '../src/lib/format';
import type { Action, CaseInput, CaseView, ReviewView } from '../src/types';
import providerFixture from './fixtures/paypal-case.json' with { type: 'json' };

async function providerCase(): Promise<CaseView> {
  const [demo] = await createDemoCases();
  return {
    ...demo,
    origin: 'paypal',
    external_id: providerFixture.external_id,
    data: clone(providerFixture) as CaseInput,
  };
}

test('merchant presentation uses typed provider fields and refreshes changed metadata', async () => {
  const view = await providerCase();
  const current = normalizeCase(view);
  expect(current.display.customer).toBe('Demo Customer');
  expect(current.display.orderId).toBe('INV-1037');
  expect(current.display.product).toBe('Wireless headphones');
  expect(current.display.dueAt).toBe('2026-10-16T23:59:59+02:00');
  const refreshed = clone(view);
  refreshed.data.paypal!.seller_response_due_date = '2026-10-25T18:00:00Z';
  refreshed.data.paypal!.transactions[0].buyer!.name = 'Updated source name';
  const changed = normalizeCase(refreshed, current);
  expect(changed.display.dueAt).toBe('2026-10-25T18:00:00Z');
  expect(changed.display.customer).toBe('Updated source name');
});

test('missing provider values never inherit old identity or a buyer response deadline', async () => {
  const view = await providerCase();
  const old = normalizeCase(view);
  view.data.paypal!.seller_response_due_date = null;
  view.data.paypal!.transactions = [];
  const current = normalizeCase(view, old);
  expect(current.display.dueAt).toBeNull();
  expect(current.display.customer).toBe('Customer not supplied');
  expect(current.display.product).toBe('Item not supplied by PayPal');
  expect(current.display.orderId).toBe('Not supplied by PayPal');
  view.data.paypal = null;
  expect(normalizeCase(view, old).display.dueAt).toBeNull();
});

test('currency formatting retains three-decimal amounts and native zero-decimal amounts', () => {
  expect(money('12.345', 'BHD')).toContain('12.345');
  expect(money('1234', 'JPY')).not.toContain('.00');
  expect(money('79.50', 'EUR')).toContain('79.50');
});

async function connectFixture(page: Page, item: CaseView) {
  let review: ReviewView | null = null;
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    let body: unknown;
    if (path === '/api/ready')
      body = { status: 'ready', execution_mode: 'dry_run', llm_provider: 'demo' };
    else if (path === '/api/v1/metrics')
      body = { cases: { review_required: 1 }, runs: {}, executions: {}, webhooks: {} };
    else if (path === '/api/v1/policies') body = { items: [] };
    else if (path === '/api/v1/disputes' || path === '/api/v1/reviews')
      body = { items: [item], total: 1, offset: 0, limit: 200 };
    else if (path === `/api/v1/disputes/${item.id}`) body = item;
    else if (path.endsWith('/audit')) body = { events: [], head: '0'.repeat(64), verified: true };
    else if (path.endsWith('/review')) {
      if (route.request().method() === 'POST') {
        const payload = route.request().postDataJSON() as { action: Action; note: string };
        review = {
          id: 'synthetic-review',
          run_id: item.latest_run!.id,
          action: payload.action,
          note: payload.note,
          actor: 'reviewer',
          created_at: '2026-10-09T12:00:00Z',
        };
        item.status = payload.action === 'no_action' ? 'held' : 'reviewed';
      }
      body = review;
    } else if (path.endsWith('/executions')) body = { items: [] };
    else {
      await route.fulfill({ status: 404, json: { detail: 'Unexpected test API route' } });
      return;
    }
    await route.fulfill({ status: 200, json: body });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Connect API', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Connect your workspace', exact: true });
  await dialog.getByLabel('Workspace key', { exact: true }).fill('synthetic-test-key');
  await dialog.getByRole('button', { name: 'Connect API', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await page.getByTestId('case-grid').getByText('Demo Customer', { exact: true }).click();
}

test('connected browser shows provider deadlines, transactions, evidence requirements and tracking', async ({
  page,
}) => {
  const view = await providerCase();
  await connectFixture(page, view);
  await expect(page.locator('.case-metadata-strip')).toContainText('Oct 16, 2026');
  await expect(page.getByRole('heading', { name: 'Demo Customer', exact: true })).toBeVisible();
  await page.locator('.case-record-details summary').first().click();
  const record = page.getByRole('region', { name: 'PayPal record', exact: true });
  await expect(record).toContainText('Waiting for seller response');
  await expect(record).toContainText('Chargeback');
  await expect(record).toContainText('Proof of delivery signature');
  await record.locator('summary').filter({ hasText: 'Transactions and items' }).click();
  await expect(record).toContainText('Wireless headphones');
  await expect(record).toContainText('INV-1037');
  await record.locator('summary').filter({ hasText: 'Delivery and refunds' }).click();
  await expect(record).toContainText('TRACK4242');
  await expect(record).toContainText('REFUND4242');
});

test('a unique model without a response displays blocking diagnostics instead of a certain decision', async ({
  page,
}) => {
  const view = await providerCase();
  const result = view.latest_run!.result!;
  result.governance.recommended_action = null;
  result.governance.requires_human = true;
  result.solver!.models[0].decisions = [];
  result.solver!.diagnostic_details = [
    {
      code: 'no_executable_decision',
      severity: 'error',
      message: 'No executable merchant response follows from the supplied evidence.',
      fact_ids: [],
      rule_ids: [],
      literals: [],
      suggestions: [],
    },
    {
      code: 'unreachable_premise',
      severity: 'warning',
      message: 'The delivery rule requires a supported delivery record.',
      fact_ids: [],
      rule_ids: ['delivery'],
      literals: ['delivery_verified'],
      suggestions: ['delivery_confirmed'],
    },
  ];
  await connectFixture(page, view);
  const response = page.getByRole('region', { name: 'Next response', exact: true });
  await expect(
    response.getByRole('heading', { name: 'More information needed', exact: true }),
  ).toBeVisible();
  await expect(response).toContainText('No response established');
  await expect(response).not.toContainText('One consistent outcome');
  const diagnostics = page.getByRole('region', { name: 'Analysis diagnostics', exact: true });
  await expect(diagnostics).toContainText('Blocking issue');
  await expect(diagnostics).toContainText('Review needed');
  await expect(diagnostics).toContainText('Check the source before changing a fact');
  await expect(page.getByRole('button', { name: 'Simulate response', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Reasoning graph', exact: true }).click();
  await expect(
    page.getByRole('region', { name: 'Analysis diagnostics', exact: true }),
  ).toContainText('Blocking issue');
  await page
    .getByRole('navigation', { name: 'Case sections', exact: true })
    .getByRole('button', { name: 'Overview', exact: true })
    .click();
  await page.getByRole('button', { name: 'Review decision', exact: true }).click();
  const reviewDialog = page.getByRole('dialog', { name: 'Record your decision', exact: true });
  await reviewDialog.locator('input[value="provide_evidence"]').check();
  await reviewDialog
    .getByLabel('Review note', { exact: true })
    .fill('Operator selected a permitted response after checking the original source.');
  await reviewDialog.getByRole('button', { name: 'Record decision', exact: true }).click();
  await expect(reviewDialog).toHaveCount(0);
  await expect(response).toContainText('Your decision is recorded');
  await expect(response).toContainText('No response established');
  await expect(response).not.toContainText('One consistent outcome');
  await page.locator('.decision-details summary').first().click();
  await expect(page.locator('.confidence')).toContainText('No merchant response established');
});
