// Real browser cookies, PostgreSQL and the real portal routes, with only Jev simulated.
import { test, expect } from '@playwright/test';
import { en } from '../../src/locales/en.js';
import { portalText as text } from '../../src/locales/portal.js';

test('a member registers, classifies an email, reviews usage and signs back in', async ({page}) => {
  const email = 'browser-member@example.test';
  await page.goto('/');
  await page.getByRole('link', { name: text.portal }).click();
  await expect(page.getByRole('heading', { name: text.loginHeading })).toBeVisible();
  await page.goto('/app');
  await expect(page).toHaveURL(/\/login$/);
  await page.getByRole('link', {name: text.toRegister}).click();
  await page.getByLabel(text.email, {exact:true}).fill(email);
  await page.getByLabel(text.password, {exact:true}).fill('member-test-password');
  await page.getByRole('button', {name:text.register}).click();
  await expect(page).toHaveURL(/\/app$/);
  await expect(page.getByText(email)).toBeVisible();
  await expect(page.locator('.portal-usage strong')).toHaveText('0');
  await expect(page.getByRole('region', { name: text.netlifyCredits })).toContainText(text.noCreditCheck);
  await page.getByLabel(text.subject).fill(en.fixtures.signoff.subject);
  await page.getByLabel(text.message).fill(en.fixtures.signoff.text);
  await page.getByRole('button', {name:text.classify}).click();
  await expect(page.getByRole('status')).toContainText('Urgent');
  await expect(page.locator('.portal-usage strong')).toHaveText('1');
  await page.goto('/admin');
  await expect(page).toHaveURL(/\/app$/);
  await page.getByRole('button', {name:text.signOut}).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.getByLabel(text.email).fill(email);
  await page.getByLabel(text.password).fill('member-test-password');
  await page.getByRole('button', {name:text.signIn}).click();
  await expect(page).toHaveURL(/\/app$/);
  await expect(page.locator('.portal-usage strong')).toHaveText('1');
  await expect(page.locator('.portal-history')).toContainText('Urgent');
});

test('usage shows a verified zero team balance and the original check time', async ({page}) => {
  const checkedAt = '2026-11-10T12:30:00Z';
  await page.route('**/v1/auth/me', route => route.fulfill({ json: { id: 'member', email: 'member@example.test', role: 'user' } }));
  await page.route('**/v1/classifications', route => route.fulfill({ json: { results: [] } }));
  await page.route('**/v1/usage/me', route => route.fulfill({ json: {
    requests: 7, successful: 7, lastRequest: null, netlifyCreditBalance: { remaining: '0', checkedAt },
  } }));
  await page.goto('/app');
  const team = page.getByRole('region', { name: text.netlifyCredits });
  await expect(page.locator('.portal-usage strong')).toHaveText('7');
  await expect(team.getByText('0', { exact: true })).toBeVisible();
  await expect(team).toContainText(text.manuallyChecked);
  await expect(team.locator('time')).toHaveAttribute('datetime', checkedAt);
  await expect(team.locator('time')).toContainText('2026');
});

test('administrator login opens the registered users list', async ({page}) => {
  await page.goto('/login');
  await page.getByLabel(text.email).fill('admin@example.test');
  await page.getByLabel(text.password).fill('browser-test-only');
  await page.getByRole('button', {name:text.signIn}).click();
  await expect(page).toHaveURL(/\/admin$/);
  await expect(page.getByRole('heading', {name:text.accounts})).toBeVisible();
  await expect(page.getByRole('cell', {name:'admin@example.test', exact:true})).toBeVisible();
  await expect(page.getByRole('table').getByRole('button')).toHaveCount(0);
});
