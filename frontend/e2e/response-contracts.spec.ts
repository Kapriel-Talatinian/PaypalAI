import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { createDemoCases } from '../src/data/demo';
import { draftResponse } from '../src/lib/response';

test('response drafts quote verified evidence without promoting unverified records or mutating sources', async () => {
  const [item] = await createDemoCases();
  item.data.evidence.push({
    id: 'unchecked',
    kind: 'statement',
    content: 'UNVERIFIED_SENTINEL',
    verified: false,
    source: 'operator',
  });
  const before = JSON.stringify(item);
  const draft = draftResponse(item, 'provide_evidence');
  expect(draft).toContain('Carrier delivery scan confirms delivery to the order address.');
  expect(draft).toContain(item.external_id!);
  expect(draft).not.toContain('FACT:');
  expect(draft).not.toContain('UNVERIFIED_SENTINEL');
  expect(JSON.stringify(item)).toBe(before);
});

test('missing verified evidence and customer messages require operator content', async () => {
  const [item] = await createDemoCases();
  item.data.evidence.forEach((record) => (record.verified = false));
  expect(draftResponse(item, 'provide_evidence')).toBe('');
  expect(draftResponse(item, 'send_message')).toBe('');
  expect(draftResponse(item, 'no_action')).toBe('');
  expect(draftResponse(item, null)).toBe('');
});

test('large evidence sets disclose excerpts and omitted records within the submission limit', async () => {
  const [item] = await createDemoCases();
  item.data.evidence = Array.from({ length: 8 }, (_, index) => ({
    id: `verified_${index}`,
    kind: 'inspection',
    content: `Original record ${index}: ${'source text '.repeat(150)}`,
    verified: true,
    source: 'operator',
  }));
  const draft = draftResponse(item, 'provide_evidence');
  expect(draft.length).toBeLessThanOrEqual(2000);
  expect(draft).toContain('[excerpt]');
  expect(draft).toContain('Additional verified records remain available');
  expect(draft).not.toContain('verified_7');
});

test('an approved evidence response opens with an editable draft and submits the operator version', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: "Open Camille Laurent's case", exact: true }).click();
  await page.getByRole('button', { name: 'Review decision', exact: true }).click();
  const review = page.getByRole('dialog', { name: 'Record your decision' });
  await review
    .getByLabel('Review note', { exact: true })
    .fill(
      'Reviewed the linked delivery records and policy clauses. Approve the evidence response.',
    );
  await review.getByRole('button', { name: 'Record decision', exact: true }).click();
  await page.getByRole('button', { name: 'Simulate response', exact: true }).click();
  const submit = page.getByRole('dialog', { name: 'Simulate your response' });
  const text = submit.getByLabel('Evidence to submit', { exact: true });
  await expect(text).toHaveValue(/Carrier delivery scan confirms delivery to the order address\./);
  await expect(text).not.toHaveValue(/FACT:/);
  await expect(submit).toContainText('Draft uses excerpts from verified evidence.');
  await text.fill('Operator reviewed and edited the evidence submission for this synthetic case.');
  await submit.getByRole('button', { name: 'Run simulation', exact: true }).click();
  await expect(page.getByText('Simulation complete', { exact: true })).toBeVisible();
  await page
    .getByRole('navigation', { name: 'Case sections' })
    .getByRole('button', { name: 'Audit trail', exact: true })
    .click();
  await expect(page.getByText('Hash chain verified', { exact: true })).toBeVisible();
  await page.locator('.case-record-details summary').click();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export case', exact: true }).click();
  const file = await downloadPromise;
  const saved = JSON.parse(await readFile((await file.path())!, 'utf8'));
  expect(saved.case.execution.payload.evidences[0].notes).toBe(
    'Operator reviewed and edited the evidence submission for this synthetic case.',
  );
});
