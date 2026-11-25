// The first page is a public email list, including during initial review and API outages.
import { test, expect } from '@playwright/test';
import { en } from '../../src/locales/en.js';
import { priorityInboxText as labels } from '../../src/locales/priorityInbox.js';
import type { PublicInboxSnapshot, RoutineEmail } from '../../src/shared/types.js';

const reviewed: PublicInboxSnapshot = {
  cards: [
    { id: 'one', tier: 'Emergency', ...en.fixtures.outage, preview: en.fixtures.outage.text, receivedAt: '2026-11-20T18:10:00Z' },
    { id: 'two', tier: 'Urgent', ...en.fixtures.signoff, preview: en.fixtures.signoff.text, receivedAt: '2026-11-20T17:10:00Z' },
  ],
  routineCount: 0, reviewAvailable: true, processing: { pending: 0, failed: 0 },
};

test('a visitor can read the public inbox with the keyboard even if the session check fails', async ({ page }) => {
  const calls: string[] = [];
  page.on('request', request => { if (request.url().includes('/v1/')) calls.push(request.method() + ' ' + new URL(request.url()).pathname); });
  await page.route('**/v1/priority', route => route.fulfill({ json: reviewed }));
  await page.route('**/v1/auth/me', route => route.fulfill({ status: 503, json: {} }));
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
  await expect(page.getByRole('navigation').getByRole('link')).toHaveText([labels.tryEmailDemo]);
  expect(new Set(calls)).toEqual(new Set(['GET /v1/priority', 'GET /v1/auth/me']));
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

test('live mode shows the real address and discovers newly reviewed mail in an initially idle inbox', async ({ page }) => {
  await page.clock.install();
  let arrived = false;
  await page.route('**/v1/priority', route => route.fulfill({ json: { ...reviewed, receivingAddress: labels.receivingAddress,
    cards: arrived ? [reviewed.cards[1]] : [] } }));
  await page.goto('/');
  await expect(page.getByRole('link', { name: labels.receivingAddress })).toHaveAttribute('href', 'mailto:' + labels.receivingAddress);
  await expect(page.getByText(labels.receivingHint)).toBeVisible();
  await expect(page.getByRole('status')).toHaveText(labels.empty);
  arrived = true;
  await page.clock.fastForward(31000);
  await expect(page.locator('.email-subject')).toHaveText([en.fixtures.signoff.subject]);
  await expect(page.locator('.priority-tag')).toHaveText(['Urgent']);
});

test('lower-priority live mail loads on expansion, updates while open, and collapses with the keyboard', async ({ page }) => {
  await page.clock.install();
  const messages: RoutineEmail[] = [
    { id: 'digest', subject: 'Monthly digest', receivedAt: '2026-11-20T15:00:00Z' },
    { id: 'legacy', subject: null, receivedAt: '2026-11-19T10:00:00Z' },
  ];
  let detailRequests = 0;
  await page.route('**/v1/priority*', route => {
    const includeRoutine = new URL(route.request().url()).searchParams.get('include') === 'routine';
    if (includeRoutine) detailRequests++;
    return route.fulfill({ json: { ...reviewed, receivingAddress: labels.receivingAddress,
      routineCount: messages.length, ...(includeRoutine && { routineMessages: messages }) } });
  });
  await page.goto('/');
  const toggle = page.getByRole('button', { name: labels.routineHeading });
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(toggle.locator('.routine-count')).toHaveText('2');
  await expect(page.getByText('Monthly digest')).toHaveCount(0);
  expect(detailRequests).toBe(0);

  await toggle.press('Enter');
  const list = page.locator('#routine-emails');
  await expect(list.getByText('Monthly digest')).toBeVisible();
  await expect(list.getByText(labels.subjectUnavailable)).toBeVisible();
  await expect(list.locator('time').last()).toHaveAttribute('datetime', messages[1].receivedAt);
  messages.unshift({ id: 'new', subject: 'Service newsletter', receivedAt: '2026-11-21T15:00:00Z' });
  await page.clock.fastForward(31000);
  await expect(toggle.locator('.routine-count')).toHaveText('3');
  await expect(list.locator('li').first()).toContainText('Service newsletter');
  await toggle.press('Space');
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByText('Monthly digest')).toHaveCount(0);
});

test('a failed expansion can be retried without losing the priority list', async ({ page }) => {
  let failDetails = true;
  await page.route('**/v1/priority*', route => {
    const expanded = new URL(route.request().url()).searchParams.has('include');
    if (expanded && failDetails) return route.fulfill({ status: 503 });
    return route.fulfill({ json: { ...reviewed, routineCount: 0, ...(expanded && { routineMessages: [] }) } });
  });
  await page.goto('/');
  const toggle = page.getByRole('button', { name: labels.routineHeading });
  await toggle.click();
  await expect(page.getByText(labels.routineError)).toBeVisible();
  await expect(page.locator('.priority-email')).toHaveCount(2);
  failDetails = false;
  await page.getByRole('button', { name: labels.retry }).click();
  await expect(page.getByText(labels.routineEmpty)).toBeVisible();
  await expect(toggle.locator('.routine-count')).toHaveText('0');
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
