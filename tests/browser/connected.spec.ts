// Browser acceptance of manual connection, incoming mail and compose/reply without Jev.
import { test, expect } from '@playwright/test';
import type { Server } from 'node:http';
import { MailFixture } from '../mail-fixture.js';
import { en } from '../../src/locales/en.js';

let fixture: MailFixture;
let server: Server;
let base: string;
test.beforeAll(async () => {
  fixture = new MailFixture('http://127.0.0.1:3102');
  server = fixture.application.app.listen(3102, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  base = 'http://127.0.0.1:3102';
});
test.afterAll(() => { server.close(); server.closeAllConnections(); fixture.database.connection.close(); });

test('login hides server settings and demo opens fictional mail without signing in', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.goto(base);
  await expect(page.getByRole('heading', { name: en.mail.connectHeading })).toBeVisible();
  await expect(page.getByLabel(en.mail.imapHost)).toHaveCount(0);
  await expect(page.getByLabel(en.mail.password)).toHaveCount(0);
  await page.screenshot({ path: 'test-results/login-centered-card.png', fullPage: true });
  await page.getByRole('button', { name: en.mail.anotherAccount }).click();
  await expect(page.getByLabel(en.mail.imapHost)).toBeVisible();
  await page.getByRole('button', { name: en.mail.backToOptions }).click();
  await page.getByRole('link', { name: en.mail.viewDemo }).click();
  await expect(page).toHaveURL(base + '/demo');
  await expect(page.locator('.inbox-queue button')).toHaveCount(6);
  await expect(page.locator('.inbox-queue button').first()).toHaveAttribute('aria-current', 'true');
  await expect(page.locator('.message-body')).toHaveText(en.fixtures.outage.text);
  await expect(page.locator('.inbox-queue button').first().locator('.message-preview')).toHaveText(en.fixtures.outage.text);
  const previewStyle = await page.locator('.message-preview').first().evaluate(element => {
    const style = getComputedStyle(element);
    return { lines: style.webkitLineClamp, height: element.getBoundingClientRect().height, lineHeight: parseFloat(style.lineHeight) };
  });
  expect(previewStyle.lines).toBe('2');
  expect(previewStyle.height).toBeLessThanOrEqual(previewStyle.lineHeight * 2);
  const selector = page.getByRole('group', { name: en.mail.inboxView });
  await expect(page.getByRole('heading', { name: en.inbox, exact: true })).toBeVisible();
  await expect(selector.getByRole('button', { name: en.mail.priority, exact: true })).toHaveAttribute('aria-pressed', 'true');
  const selectorBounds = await selector.boundingBox();
  const messageBounds = await page.locator('.inbox-queue button').first().boundingBox();
  expect(selectorBounds!.y + selectorBounds!.height).toBeLessThanOrEqual(messageBounds!.y);
  expect(selectorBounds!.x).toBeGreaterThanOrEqual(messageBounds!.x);
  expect(selectorBounds!.x + selectorBounds!.width).toBeLessThanOrEqual(messageBounds!.x + messageBounds!.width);
  await page.getByRole('button', { name: en.mail.all, exact: true }).click();
  await expect(selector.getByRole('button', { name: en.mail.all, exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.inbox-queue button')).toHaveCount(9);
  await page.getByRole('button', { name: new RegExp(en.fixtures.security.subject) }).click();
  await expect(page.locator('.message-body')).toHaveText(en.fixtures.security.text);
  await page.screenshot({ path: 'test-results/inbox-selector-desktop.png', fullPage: true });
  expect((await page.request.get(base + '/v1/account')).status()).toBe(401);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await expect(page.locator('.inbox-queue button')).toHaveCount(6);
  await expect(page.locator('.inbox-queue button').first()).toHaveAttribute('aria-current', 'true');
  await selector.getByRole('button', { name: en.mail.all, exact: true }).click();
  await expect(page.locator('.inbox-queue button')).toHaveCount(9);
  await expect(page.locator('.inbox-queue button').first()).toHaveAttribute('aria-current', 'true');
  const priority = selector.getByRole('button', { name: en.mail.priority, exact: true });
  await expect(priority).toBeEnabled();
  await priority.focus();
  await expect(priority).toBeFocused();
  await page.keyboard.press('Space');
  await expect(page.locator('.inbox-queue button')).toHaveCount(6);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/inbox-selector-mobile.png', fullPage: true });
  await page.getByRole('button', { name: en.mail.signOut }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('link', { name: en.mail.viewDemo })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/login-centered-card-mobile.png', fullPage: true });
});

test('connect, read, compose, reply and sign out on desktop and mobile', async ({ page }) => {
  await page.goto(base);
  await page.getByRole('button', { name: en.mail.anotherAccount }).click();
  await page.getByLabel(en.mail.email, { exact: true }).fill('browser@example.test');
  await page.getByLabel(en.mail.imapHost).fill('imap.example.test');
  await page.getByLabel(en.mail.smtpHost).fill('smtp.example.test');
  await page.getByLabel(en.mail.user, { exact: true }).fill('browser@example.test');
  await page.getByLabel(en.mail.password).fill('password');
  await page.getByRole('button', { name: en.mail.connect, exact: true }).click();
  await expect(page.getByText(en.mail.empty, { exact: false })).toBeVisible();
  await expect(page.locator('.inbox-pane').getByRole('group', { name: en.mail.inboxView })).toBeVisible();
  await page.getByRole('button', { name: en.mail.all, exact: true }).first().click();
  await expect(page.locator('.inbox-pane .queue-item').first()).toHaveAttribute('aria-current', 'true');
  await expect(page.locator('.inbox-pane .queue-item').first().locator('.message-preview')).toHaveText('Please reply.');
  await expect(page.locator('.message-body')).toHaveText('Please reply.');
  await page.getByRole('button', { name: /Mail for browser/ }).click();
  await expect(page.locator('.message-body')).toHaveText('Please reply.');
  await page.getByRole('combobox', { name: en.mail.correction, exact: true }).selectOption('Urgent');
  await page.reload();
  await expect(page.locator('.inbox-pane .queue-item').first()).toHaveAttribute('aria-current', 'true');
  await expect(page.locator('.message-body')).toHaveText('Please reply.');
  await page.getByRole('button', { name: en.mail.reply, exact: true }).click();
  await expect(page.getByLabel(en.mail.to, { exact: true })).toHaveValue('reply@example.test');
  await expect(page.getByLabel(en.mail.subject, { exact: true })).toHaveValue('Re: Question');
  await page.getByLabel(en.mail.body, { exact: true }).fill('Reply from browser');
  await page.getByRole('button', { name: en.mail.send, exact: true }).click();
  await expect(page.getByText(en.mail.sent)).toBeVisible();
  await page.getByRole('button', { name: en.mail.close, exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: en.mail.compose, exact: true }).click();
  await page.getByLabel(en.mail.to, { exact: true }).fill('to@example.test');
  await page.getByLabel(en.mail.bcc, { exact: true }).fill('hidden@example.test');
  await page.getByLabel(en.mail.subject, { exact: true }).fill('New message');
  await page.getByLabel(en.mail.body, { exact: true }).fill('Message from mobile');
  await page.getByRole('button', { name: en.mail.send, exact: true }).click();
  await expect(page.getByText(en.mail.sent)).toBeVisible();
  expect(fixture.sends).toBe(2);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(page.locator('header button')).toHaveText([en.mail.compose, en.mail.signOut]);
  await page.getByRole('button', { name: en.mail.signOut, exact: true }).click();
  await expect(page.getByRole('heading', { name: en.mail.connectHeading })).toBeVisible();
});

test('demo and account mail share controls, priority colours and the split layout', async ({ page, context }) => {
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.goto(base);
  await page.getByRole('button', { name: en.mail.anotherAccount }).click();
  await page.getByLabel(en.mail.email, { exact: true }).fill('layout@example.test');
  await page.getByLabel(en.mail.imapHost).fill('imap.example.test');
  await page.getByLabel(en.mail.smtpHost).fill('smtp.example.test');
  await page.getByLabel(en.mail.user, { exact: true }).fill('layout@example.test');
  await page.getByLabel(en.mail.password).fill('password');
  await page.getByRole('button', { name: en.mail.connect, exact: true }).click();
  await page.getByRole('button', { name: en.mail.all, exact: true }).first().click();

  const demo = await context.newPage();
  await demo.setViewportSize({ width: 1440, height: 960 });
  await demo.goto(base + '/demo');
  await demo.getByRole('button', { name: en.mail.all, exact: true }).click();
  for (const inbox of [page, demo]) {
    await expect(inbox.locator('.message-body')).toBeVisible();
    await expect(inbox.locator('.queue-item[aria-current=true]')).toHaveCount(1);
    await expect(inbox.locator('header button')).toHaveText([en.mail.compose, en.mail.signOut]);
    await expect(inbox.locator('.mail-list-toolbar').getByRole('button', { name: en.mail.refresh })).toBeVisible();
    const queue = await inbox.locator('.queue-container').boundingBox();
    const reader = await inbox.locator('.reader-pane').boundingBox();
    expect(reader!.x).toBeGreaterThanOrEqual(queue!.x + queue!.width);
    await expect(inbox.locator('.queue-container')).toHaveCSS('border-right-style', 'solid');
    await expect(inbox.locator('.queue-container')).toHaveCSS('border-right-width', '1px');
    const dropdown = inbox.getByRole('combobox', { name: en.mail.correction, exact: true });
    await expect(dropdown).toHaveCSS('border-radius', '5px');
    expect((await dropdown.boundingBox())!.height).toBe((await inbox.getByRole('button', { name: en.mail.handled }).boundingBox())!.height);
  }
  const controls = 'header button, .mail-list-toolbar button, .inbox-view-selector button, .reader-toolbar button, .reader-toolbar select';
  expect(await demo.locator(controls).allTextContents()).toEqual(await page.locator(controls).allTextContents());

  const colours = new Set<string>();
  for (const tier of ['Emergency', 'Urgent', 'Routine']) {
    for (const inbox of [page, demo]) {
      await inbox.getByRole('combobox', { name: en.mail.correction, exact: true }).selectOption(tier);
      await expect(inbox.locator('.queue-item[aria-current=true] .tier')).toHaveText(tier);
      await expect(inbox.locator('.reader-content > .tier')).toHaveText(tier);
    }
    const badgeColour = await page.locator('.queue-item[aria-current=true] .tier').evaluate(element => getComputedStyle(element).backgroundColor);
    await expect(demo.locator('.queue-item[aria-current=true] .tier')).toHaveCSS('background-color', badgeColour);
    colours.add(badgeColour);
  }
  expect(colours.size).toBe(3);
  await page.screenshot({ path: 'test-results/shared-account-desktop.png', fullPage: true });
  await demo.screenshot({ path: 'test-results/shared-demo-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('.queue-item').first().click();
  await expect(page.locator('.reader-pane')).toBeVisible();
  await expect(page.locator('.queue-container')).toBeHidden();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/shared-account-mobile.png', fullPage: true });
  await page.getByRole('button', { name: en.back }).click();
  await expect(page.locator('.queue-container')).toBeVisible();
  await demo.close();
});

test('demo controls edit only mock data and simulate sends', async ({ page }) => {
  const liveMutations: string[] = [];
  page.on('request', request => {
    if (request.method() !== 'GET' && /\/v1\/(messages|sync|session)/.test(request.url())) liveMutations.push(request.url());
  });
  await page.goto(base + '/demo');
  await expect(page.locator('.inbox-queue .queue-item')).toHaveCount(6);
  await page.getByRole('button', { name: en.mail.handled }).click();
  await expect(page.locator('.inbox-queue .queue-item')).toHaveCount(5);
  await page.getByRole('button', { name: en.mail.compose, exact: true }).click();
  await page.getByLabel(en.mail.to, { exact: true }).fill('someone@example.test');
  await page.getByLabel(en.mail.subject, { exact: true }).fill('Sample message');
  await page.getByLabel(en.mail.body, { exact: true }).fill('This must never be delivered.');
  await page.getByRole('button', { name: en.mail.send, exact: true }).click();
  await expect(page.getByRole('status')).toHaveText(en.mail.simulated);
  await page.reload();
  await expect(page.locator('.inbox-queue .queue-item')).toHaveCount(6);
  expect(liveMutations).toEqual([]);
});
