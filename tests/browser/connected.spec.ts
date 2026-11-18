// The fictional inbox remains a public preview; its writes stay in the mock client.
import { test, expect } from '@playwright/test';
import { en } from '../../src/locales/en.js';

test('demo inbox opens without an account and edits only mock data', async ({ page }) => {
  const mutations: string[] = [];
  page.on('request', request => {
    if (request.method() !== 'GET' && /\/v1\/(messages|sync|session)/.test(request.url())) mutations.push(request.url());
  });
  await page.goto('/demo');
  await expect(page.locator('.inbox-queue button')).toHaveCount(6);
  await expect(page.locator('.message-body')).toHaveText(en.fixtures.outage.text);
  await page.getByRole('button', { name: en.mail.handled }).click();
  await expect(page.locator('.inbox-queue button')).toHaveCount(5);
  await page.getByRole('button', { name: en.mail.compose, exact: true }).click();
  await page.getByLabel(en.mail.to, { exact: true }).fill('sample@example.test');
  await page.getByLabel(en.mail.subject, { exact: true }).fill('Fictional message');
  await page.getByLabel(en.mail.body, { exact: true }).fill('This is only a demo.');
  await page.getByRole('button', { name: en.mail.send, exact: true }).click();
  await expect(page.getByRole('status')).toHaveText(en.mail.simulated);
  await page.reload();
  await expect(page.locator('.inbox-queue button')).toHaveCount(6);
  expect(mutations).toEqual([]);
});
