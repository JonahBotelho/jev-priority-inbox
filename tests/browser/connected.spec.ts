// Existing inbox bookmarks open the same public page on a narrow screen.
import { test, expect } from '@playwright/test';
import { priorityInboxText as labels } from '../../src/locales/priorityInbox.js';
import { en } from '../../src/locales/en.js';

test.use({ viewport: { width: 360, height: 800 } });

for (const path of ['/demo', '/inbox']) {
  test(`${path} opens the public inbox on mobile without an account`, async ({ page }) => {
    await page.goto(path);
    await expect(page.getByText(labels.address, { exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: labels.heading })).toBeVisible();
    // The loopback fixture reviews these messages without using a paid provider.
    await expect(page.getByText(en.fixtures.outage.subject, { exact: true })).toBeVisible();
    await expect(page.locator('form, input[type=password]')).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
}
