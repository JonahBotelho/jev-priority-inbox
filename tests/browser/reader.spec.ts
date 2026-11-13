// Split-reader behavior, live arrivals, keyboard navigation, and mobile drill-in.
import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { en } from '../../src/locales/en.js';

test('split reader preserves mail, switches without dismissal, and works on mobile', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.goto('/');
  await page.getByLabel(en.password).fill('browser-test-password');
  await page.getByRole('button', { name: en.signIn }).click();
  await expect(page.getByRole('button', { name: en.signOut })).toBeVisible();
  await expect(page.locator('header .brand')).toHaveText(en.brand + en.brandSubtitle);
  await expect(page.getByRole('heading', { name: 'Inbox', exact: true })).toBeVisible();
  const deliver = async (name: string) => {
    const response = await page.request.post('/v1/demo/deliver', { data: { name, deliveryId: randomUUID() } });
    expect(response.status()).toBe(202);
  };
  const heading = page.locator('.reader-content h2');
  const queue = page.getByRole('navigation', { name: en.inbox });
  const signoff = queue.getByRole('button', { name: new RegExp(en.fixtures.signoff.subject) });
  const outage = queue.getByRole('button', { name: new RegExp(en.fixtures.outage.subject) });

  await deliver('signoff');
  await expect(heading).toHaveText(en.fixtures.signoff.subject);
  await signoff.click();
  await expect(heading).toBeFocused();
  await deliver('outage');
  await expect(page.getByText(en.newEmergency)).toBeVisible();
  await expect(page.locator('.message-body')).toHaveText(en.fixtures.signoff.text);
  await expect(heading).toBeFocused();
  await page.getByRole('button', { name: en.next }).click();
  await expect(heading).toHaveText(en.fixtures.outage.subject);
  await expect(page.getByRole('button', { name: en.next })).toBeEnabled();
  await expect(queue.getByRole('button')).toHaveCount(2);

  // Enter on a queue row opens the message and transfers focus to its heading.
  await signoff.focus();
  await page.keyboard.press('Enter');
  await expect(heading).toHaveText(en.fixtures.signoff.subject);
  await expect(heading).toBeFocused();
  await page.getByRole('button', { name: en.next }).click();
  await expect(heading).toHaveText(en.fixtures.outage.subject);
  const sidebar = await page.locator('.queue-container').boundingBox();
  const reader = await page.locator('.reader-pane').boundingBox();
  expect(reader!.x).toBeGreaterThanOrEqual(sidebar!.x + sidebar!.width);
  await page.screenshot({ path: 'test-results/desktop-inbox.png', fullPage: true });

  await page.context().setOffline(true);
  await page.context().setOffline(false);
  await page.reload();
  await expect(heading).toHaveText(en.fixtures.outage.subject);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(queue).toBeVisible();
  await expect(page.locator('.reader-pane')).toBeHidden();
  await outage.click();
  await expect(heading).toBeVisible();
  await expect(heading).toBeFocused();
  await expect(page.getByRole('button', { name: en.handled, exact: true })).toBeEnabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/mobile-reader.png', fullPage: true });
  await page.getByRole('button', { name: en.back }).click();
  await expect(outage).toBeFocused();
  await outage.click();
  await expect(heading).toBeFocused();

  await page.getByRole('button', { name: en.correction, exact: true }).click();
  await page.getByRole('combobox', { name: en.correction }).selectOption('Urgent');
  await page.getByRole('button', { name: en.save }).click();
  await expect(page.locator('.reader-content .tier')).toHaveText(en.tiers.Urgent);
  await expect(page.locator('.correction-form')).toBeHidden();
  await expect(page.getByRole('button', { name: en.correction, exact: true })).toBeFocused();
  await page.getByRole('button', { name: en.handled, exact: true }).click();
  await page.reload();
  await expect(signoff).toBeVisible();
  await expect(outage).toHaveCount(0);
  await signoff.click();
  await expect(heading).toHaveText(en.fixtures.signoff.subject);
  await page.getByRole('button', { name: en.handled, exact: true }).click();
  await expect(page.getByRole('heading', { name: en.empty })).toBeVisible();
  await deliver('sale');
  await deliver('recovery');
  await expect(page.getByText(en.processing, { exact: true })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: en.empty })).toBeVisible();
});
