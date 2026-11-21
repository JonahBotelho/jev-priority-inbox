// The first page is a public email list, including during initial review and API outages.
import { test, expect } from '@playwright/test';
import { en } from '../../src/locales/en.js';
import { priorityInboxText as labels } from '../../src/locales/priorityInbox.js';
import type { PublicInboxSnapshot } from '../../src/shared/types.js';

const reviewed: PublicInboxSnapshot = {
  cards: [
    { id: 'one', tier: 'Emergency', ...en.fixtures.outage, preview: en.fixtures.outage.text, receivedAt: '2026-11-20T18:10:00Z' },
    { id: 'two', tier: 'Urgent', ...en.fixtures.signoff, preview: en.fixtures.signoff.text, receivedAt: '2026-11-20T17:10:00Z' },
  ],
  reviewAvailable: true, processing: { pending: 0, failed: 0 },
};

test('a visitor sees the demo address and tagged emails and can open a message with the keyboard', async ({ page }) => {
  const calls: string[] = [];
  page.on('request', request => { if (request.url().includes('/v1/')) calls.push(request.method() + ' ' + new URL(request.url()).pathname); });
  await page.route('**/v1/priority', route => route.fulfill({ json: reviewed }));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: labels.heading })).toBeVisible();
  await expect(page.getByText(labels.address, { exact: true })).toBeVisible();
  await expect(page.getByText(labels.addressHint)).toBeVisible();
  await expect(page.locator('.priority-tag')).toHaveText(['Emergency', 'Urgent']);
  await expect(page.locator('.email-subject')).toHaveText([en.fixtures.outage.subject, en.fixtures.signoff.subject]);
  const first = page.locator('details').first();
  await first.locator('summary').focus();
  await page.keyboard.press('Enter');
  await expect(first.locator('.email-text')).toBeVisible();
  await expect(first.locator('.email-text')).toHaveText(en.fixtures.outage.text);
  await expect(page.locator('form, input[type=password]')).toHaveCount(0);
  expect(calls.length).toBeGreaterThan(0);
  expect(calls.every(call => call === 'GET /v1/priority')).toBe(true);
});

test('the list updates when Jev finishes reviewing samples', async ({ page }) => {
  let complete = false;
  await page.route('**/v1/priority', route => route.fulfill({ json: complete
    ? reviewed : { ...reviewed, cards: [], processing: { pending: 2, failed: 0 } } }));
  await page.goto('/');
  await expect(page.getByRole('status')).toHaveText(labels.reviewing);
  complete = true;
  await expect(page.locator('.priority-email')).toHaveCount(2);
});

test('a failed request can be retried and a finished empty inbox is distinct from a failure', async ({ page }) => {
  let healthy = false;
  await page.route('**/v1/priority', route => healthy
    ? route.fulfill({ json: { ...reviewed, cards: [] } })
    : route.fulfill({ status: 503, body: '' }));
  await page.goto('/');
  await expect(page.getByText(labels.loadError)).toBeVisible();
  healthy = true;
  await page.getByRole('button', { name: labels.retry }).click();
  await expect(page.getByRole('status')).toHaveText(labels.empty);
});
