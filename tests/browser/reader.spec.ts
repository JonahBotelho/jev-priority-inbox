// Normal startup must use the account interface even with a legacy demo setting.
import { test, expect } from '@playwright/test';
import { en } from '../../src/locales/en.js';

test('the website always opens account connections instead of the classroom login', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: en.mail.connectHeading })).toBeVisible();
  await expect(page.locator('input[type=password]')).toHaveCount(0);
  await expect(page.getByRole('link', { name: en.mail.viewDemo })).toBeVisible();
  expect((await page.request.get('/v1/account')).status()).toBe(401);
  expect((await page.request.post('/v1/demo/deliver', { data: { name: 'outage' } })).status()).toBe(401);
  await page.reload();
  await expect(page.getByRole('heading', { name: en.mail.connectHeading })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('heading', { name: en.mail.connectHeading })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
