// Real browser cookies, PostgreSQL and the real portal routes, with only Jev simulated.
import { test, expect } from '@playwright/test';
import { en } from '../../src/locales/en.js';
import { portalText as text } from '../../src/locales/portal.js';
import { priorityInboxText as inboxText } from '../../src/locales/priorityInbox.js';

test('a member lands on the public inbox after registration and again after signing back in', async ({page}) => {
  const email = 'browser-member@example.test';
  const demoLink = page.getByRole('link', { name: inboxText.tryEmailDemo });
  const directoryLink = page.getByRole('link', { name: text.adminDashboard });
  await Promise.all([
    page.waitForResponse(response => response.url().endsWith('/v1/auth/me') && response.status() === 401),
    page.goto('/'),
  ]);
  await expect(demoLink).toHaveAttribute('href', '/app');
  await expect(directoryLink).toHaveCount(0);
  await demoLink.click();
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole('heading', { name: text.loginHeading })).toBeVisible();
  await page.getByRole('link', {name: text.toRegister}).click();
  await page.getByLabel(text.email, {exact:true}).fill(email);
  await page.getByLabel(text.password, {exact:true}).fill('member-test-password');
  await page.getByRole('button', {name:text.register}).click();
  await expect(page).toHaveURL('/');
  await expect(page.getByRole('heading', { name: inboxText.heading })).toBeVisible();
  await demoLink.click();
  await expect(page).toHaveURL('/app');
  await expect(page.getByRole('heading', { name: text.classifier })).toBeVisible();
  await expect(page.getByText(email)).toBeVisible();
  await expect(page.getByText(text.emptyHistory)).toBeVisible();
  await expect(page.getByRole('status')).toHaveText(text.awaitingInput);
  await page.getByLabel(text.subject).fill(en.fixtures.signoff.subject);
  await page.getByLabel(text.message).fill(en.fixtures.signoff.text);
  await page.getByRole('button', {name:text.classify}).click();
  await expect(page.getByRole('status')).toContainText('Urgent');
  const historyRows = page.getByRole('region', { name: text.history }).locator('tbody tr');
  await expect(historyRows).toHaveCount(1);
  // Edit priority via PUT /v1/classifications/:id and verify persistence across sign-out/sign-in.
  await historyRows.first().getByRole('button', { name: text.edit }).click();
  await historyRows.first().getByLabel(text.priority).selectOption('Emergency');
  await historyRows.first().getByRole('button', { name: text.save }).click();
  await expect(historyRows.first().getByLabel(text.priority)).toHaveCount(0);
  await expect(historyRows.first().locator('.portal-tier')).toHaveText(en.tiers.Emergency);
  await page.goto('/admin');
  await expect(page).toHaveURL(/\/app$/);
  await page.getByRole('button', {name:text.signOut}).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.getByLabel(text.email).fill(email);
  await page.getByLabel(text.password).fill('member-test-password');
  await page.getByRole('button', {name:text.signIn}).click();
  await expect(page).toHaveURL('/');
  await expect(page.getByRole('heading', { name: inboxText.heading })).toBeVisible();
  await page.goto('/login');
  await expect(page).toHaveURL('/');
  await demoLink.click();
  await expect(page).toHaveURL('/app');
  await expect(historyRows).toHaveCount(1);
  await expect(page.locator('.portal-history')).toContainText(en.tiers.Emergency);
  // Delete classification via DELETE /v1/classifications/:id and verify removal persists across reload.
  await historyRows.first().getByRole('button', { name: text.delete }).click();
  await expect(page.getByText(text.emptyHistory)).toBeVisible();
  await page.reload();
  await expect(page.getByText(text.emptyHistory)).toBeVisible();
  await Promise.all([
    page.waitForResponse(response => response.url().endsWith('/v1/auth/me') && response.ok()),
    page.getByRole('link', { name: text.liveInbox }).click(),
  ]);
  await expect(demoLink).toBeVisible();
  await expect(directoryLink).toHaveCount(0);
});

test('the browser renders each Jev decision immediately and retries only its receipt after reload', async ({ page }) => {
  const registration = await page.request.post('http://127.0.0.1:3101/v1/auth/register', {
    data: { email: 'live-demo@example.test', password: 'browser-demo-password' },
  });
  expect(registration.status()).toBe(201);
  const requestedPaths: string[] = [];
  page.on('request', request => requestedPaths.push(new URL(request.url()).pathname));
  let releaseHistory!: () => void;
  let releaseInference!: () => void;
  const staleHistory = new Promise<void>(resolve => { releaseHistory = resolve; });
  const waitingForJev = new Promise<void>(resolve => { releaseInference = resolve; });
  await page.route('**/v1/classifications', async route => {
    await staleHistory;
    await route.fulfill({ json: { results: [] } });
  }, { times: 1 });
  await page.route('**/v1/demo/inference', async route => { await waitingForJev; await route.continue(); }, { times: 1 });
  await page.route('**/v1/demo/receipts', route => route.abort());

  await page.clock.install();
  await page.goto('/app');
  const history = page.getByRole('region', { name: text.history }).locator('tbody tr');
  const decision = page.getByRole('region', { name: text.decision });
  const form = page.locator('form');
  const left = (await form.boundingBox())!;
  expect((await decision.boundingBox())!.x).toBeGreaterThanOrEqual(left.x + left.width);
  await page.getByLabel(text.subject).fill(en.fixtures.outage.subject);
  await page.getByLabel(text.message).fill(en.fixtures.outage.text);
  await page.getByRole('button', { name: text.classify, exact: true }).click();
  await expect(decision).toContainText(text.awaitingJev);
  await page.clock.fastForward(30000);
  releaseInference();
  await expect(decision).toContainText(en.tiers.Emergency);
  const timeShown = (label: string) => decision.locator('dl div').filter({ has: page.getByText(label, { exact: true }) }).locator('dd').innerText();
  expect(parseInt(await timeShown(text.totalResponseTime))).toBeGreaterThanOrEqual(30000);
  expect(parseInt(await timeShown(text.responseTime))).toBeLessThan(30000);
  await expect(history).toHaveCount(1);
  await expect(history.first()).toContainText(en.tiers.Emergency);
  releaseHistory();
  await expect(page.getByRole('button', { name: text.retrySave })).toBeVisible();
  await page.getByLabel(text.subject).fill(en.fixtures.signoff.subject);
  await page.getByLabel(text.message).fill(en.fixtures.signoff.text);
  await page.getByRole('button', { name: text.classify, exact: true }).click();
  await expect(history).toHaveCount(2);
  await expect(history.first()).toContainText(en.tiers.Urgent);
  const waiting = await page.evaluate(() => Object.entries(localStorage).filter(([key]) => key.startsWith('jev.demo.')));
  expect(waiting).toHaveLength(2);
  expect(JSON.stringify(waiting)).not.toContain(en.fixtures.outage.subject);

  await page.unroute('**/v1/demo/receipts');
  await page.reload();
  await expect(history).toHaveCount(2);
  await expect.poll(() => page.evaluate(() => Object.keys(localStorage).filter(key => key.startsWith('jev.demo.')).length)).toBe(0);
  await page.setViewportSize({ width: 375, height: 800 });
  const mobileForm = (await form.boundingBox())!;
  expect((await decision.boundingBox())!.y).toBeGreaterThanOrEqual(mobileForm.y + mobileForm.height);
  await expect(page.getByText(/Your API usage|Netlify team credits remaining/)).toHaveCount(0);
  expect(requestedPaths.filter(path => path === '/v1/demo/inference')).toHaveLength(2);
  expect(requestedPaths).not.toContain('/v1/usage/me');
  expect(requestedPaths).not.toContain('/v1/classify');
});

test('editing after inactivity refreshes history once and can classify while the refresh is pending', async ({ page }) => {
  const registration = await page.request.post('http://127.0.0.1:3101/v1/auth/register', {
    data: { email: 'returning-demo@example.test', password: 'returning-demo-password' },
  });
  expect(registration.status()).toBe(201);
  const opened = Date.now();
  await page.clock.setFixedTime(opened);
  await page.goto('/app');
  await expect(page.getByText(text.emptyHistory)).toBeVisible();

  let refreshes = 0, inferences = 0;
  let releaseHistory!: () => void;
  const waitingForHistory = new Promise<void>(resolve => { releaseHistory = resolve; });
  await page.route('**/v1/classifications', async route => {
    refreshes++;
    await waitingForHistory;
    await route.fulfill({ json: { results: [] } });
  });
  page.on('request', request => { if (request.url().endsWith('/v1/demo/inference')) inferences++; });
  try {
    await page.clock.setFixedTime(opened + 16 * 60 * 1000);
    await page.getByLabel(text.subject).fill(en.fixtures.signoff.subject);
    await page.getByLabel(text.message).fill(en.fixtures.signoff.text);
    await expect.poll(() => refreshes).toBe(1);
    expect(inferences).toBe(0);
    await page.getByRole('button', { name: text.classify, exact: true }).click();
    await expect(page.getByRole('status')).toContainText(en.tiers.Urgent);
    await expect(page.getByRole('region', { name: text.history }).locator('tbody tr')).toHaveCount(1);
    expect(inferences).toBe(1);
    expect(refreshes).toBe(1);
  } finally { releaseHistory(); }
});

test('an untouched visible demo keeps its history current before the next classification', async ({ page }) => {
  const api = 'http://127.0.0.1:3101/v1';
  const registration = await page.request.post(api + '/auth/register', {
    data: { email: 'visible-demo@example.test', password: 'visible-demo-password' },
  });
  expect(registration.status()).toBe(201);
  await page.clock.install();
  await page.goto('/app');
  await expect(page.getByText(text.emptyHistory)).toBeVisible();
  await page.getByLabel(text.subject).fill(en.fixtures.outage.subject);
  await page.getByLabel(text.message).fill(en.fixtures.outage.text);

  const requests: string[] = [];
  page.on('request', request => requests.push(new URL(request.url()).pathname));
  const otherClient = await page.request.post(api + '/classify', { data: en.fixtures.signoff });
  expect(otherClient.status()).toBe(200);
  const history = page.getByRole('region', { name: text.history }).locator('tbody tr');
  for (let interval = 1; interval <= 3; interval++) {
    await page.clock.fastForward(5 * 60 * 1000 + 1);
    await expect.poll(() => requests.filter(path => path === '/v1/classifications').length).toBe(interval);
  }
  await expect(history).toHaveCount(1);
  await expect(history.first()).toContainText(en.tiers.Urgent);
  expect(requests).not.toContain('/v1/demo/inference');
  await page.getByRole('button', { name: text.classify, exact: true }).click();
  await expect(page.getByRole('status')).toContainText(en.tiers.Emergency);
  await expect(history).toHaveCount(2);
  expect(requests.filter(path => path === '/v1/demo/inference')).toHaveLength(1);
});

test('an administrator lands on Admin dashboard, sees server-side endpoint stats, and can return from the public inbox', async ({page}) => {
  await page.goto('/login');
  await page.getByLabel(text.email).fill('admin@example.test');
  await page.getByLabel(text.password).fill('browser-test-only');
  await page.getByRole('button', {name:text.signIn}).click();
  await expect(page).toHaveURL('/admin');
  await expect(page.getByRole('heading', {name:text.adminDashboard})).toBeVisible();
  const endpointRegion = page.getByRole('region', { name: text.endpointStats });
  const usersRegion = page.getByRole('region', { name: text.accounts });
  await expect(endpointRegion).toBeVisible();
  await expect(usersRegion).toBeVisible();
  await expect(endpointRegion.getByRole('cell', { name: '/v1/demo/inference', exact: true })).toBeVisible();
  await expect(endpointRegion.getByRole('cell', { name: '/v1/priority', exact: true })).toBeVisible();
  await expect(usersRegion.getByRole('cell', {name:'admin@example.test', exact:true})).toBeVisible();
  await expect(page.getByRole('table').getByRole('button')).toHaveCount(0);

  await page.getByRole('link', { name: text.service }).click();
  await expect(page.getByRole('heading', { name: text.classifier })).toBeVisible();
  await page.getByLabel(text.subject).fill(en.fixtures.outage.subject);
  await page.getByLabel(text.message).fill(en.fixtures.outage.text);
  await page.getByRole('button', { name: text.classify, exact: true }).click();
  await expect(page.getByRole('status')).toContainText(en.tiers.Emergency);

  await page.setViewportSize({ width: 375, height: 800 });
  await page.getByRole('link', { name: text.liveInbox }).click();
  const navigation = page.getByRole('navigation', { name: text.portal });
  await expect(navigation.getByRole('link')).toHaveText([inboxText.tryEmailDemo, text.adminDashboard]);
  const dashboardLink = navigation.getByRole('link', { name: text.adminDashboard });
  await expect(dashboardLink).toHaveAttribute('href', '/admin');
  await dashboardLink.click();
  await expect(page).toHaveURL('/admin');
  await expect(page.getByRole('heading', { name: text.adminDashboard })).toBeVisible();
  const inferenceRow = endpointRegion.locator('tbody tr', { hasText: '/v1/demo/inference' });
  await expect(inferenceRow).toContainText('POST');
  await expect(inferenceRow.locator('td').last()).not.toHaveText('0');
  await page.getByRole('button', { name: text.refresh }).click();
  await expect(endpointRegion).toBeVisible();
});

test('two tabs reconcile edited and deleted classifications after receipt confirmation', async ({ browser }) => {
  const context = await browser.newContext();
  try {
    const registration = await context.request.post('http://127.0.0.1:3101/v1/auth/register', {
      data: { email: 'two-tab@example.test', password: 'two-tab-password' },
    });
    expect(registration.status()).toBe(201);

    const tabOne = await context.newPage();
    await tabOne.clock.install();
    await tabOne.goto('/app');
    const tabOneRows = tabOne.getByRole('region', { name: text.history }).locator('tbody tr');
    await expect(tabOne.getByText(text.emptyHistory)).toBeVisible();

    // Tab 1 classifies a message and waits for receipt confirmation and its post-ack history read.
    const postAckHistory = tabOne.waitForResponse(
      response => response.url().endsWith('/v1/classifications') && response.request().method() === 'GET' && response.ok(),
    );
    await tabOne.getByLabel(text.subject).fill(en.fixtures.signoff.subject);
    await tabOne.getByLabel(text.message).fill(en.fixtures.signoff.text);
    await tabOne.getByRole('button', { name: text.classify, exact: true }).click();
    await expect(tabOneRows).toHaveCount(1);
    await expect(tabOneRows.first().locator('.portal-tier')).toHaveText(en.tiers.Urgent);
    await postAckHistory;

    // Tab 2 edits the classification priority to Emergency.
    const tabTwo = await context.newPage();
    await tabTwo.goto('/app');
    const tabTwoRows = tabTwo.getByRole('region', { name: text.history }).locator('tbody tr');
    await expect(tabTwoRows).toHaveCount(1);
    await tabTwoRows.first().getByRole('button', { name: text.edit }).click();
    await tabTwoRows.first().getByLabel(text.priority).selectOption('Emergency');
    await tabTwoRows.first().getByRole('button', { name: text.save }).click();
    await expect(tabTwoRows.first().getByLabel(text.priority)).toHaveCount(0);
    await expect(tabTwoRows.first().locator('.portal-tier')).toHaveText(en.tiers.Emergency);

    // Tab 1 returns to view, refreshes history without reloading, and reflects Tab 2's edit.
    await tabOne.bringToFront();
    await tabOne.clock.fastForward(10 * 60 * 1000);
    await expect(tabOneRows.first().locator('.portal-tier')).toHaveText(en.tiers.Emergency);

    // Tab 2 deletes the classification; Tab 1 returns to view, refreshes, and reflects the deletion.
    await tabTwo.bringToFront();
    await tabTwoRows.first().getByRole('button', { name: text.delete }).click();
    await expect(tabTwo.getByText(text.emptyHistory)).toBeVisible();
    await tabOne.bringToFront();
    await tabOne.clock.fastForward(10 * 60 * 1000);
    await expect(tabOne.getByText(text.emptyHistory)).toBeVisible();
  } finally {
    await context.close();
  }
});

test('a stale pre-mutation history read cannot undo a completed edit or delete', async ({ page }) => {
  const api = 'http://127.0.0.1:3101/v1';
  const registration = await page.request.post(api + '/auth/register', {
    data: { email: 'stale-read@example.test', password: 'stale-read-password' },
  });
  expect(registration.status()).toBe(201);
  const created = await page.request.post(api + '/classify', { data: en.fixtures.signoff });
  expect(created.status()).toBe(200);

  await page.clock.install();
  await page.goto('/app');
  const rows = page.getByRole('region', { name: text.history }).locator('tbody tr');
  await expect(rows).toHaveCount(1);
  await expect(rows.first().locator('.portal-tier')).toHaveText(en.tiers.Urgent);

  // Hold a pre-edit GET /v1/classifications while completing PUT, then release the stale response.
  let releasePreEdit!: () => void;
  const preEditHeld = new Promise<void>(resolve => { releasePreEdit = resolve; });
  let preEditIntercepted = false;
  await page.route('**/v1/classifications', async route => {
    if (!preEditIntercepted && route.request().method() === 'GET') {
      preEditIntercepted = true;
      const response = await route.fetch();
      const body = await response.json();
      await preEditHeld;
      await route.fulfill({ response, json: body }).catch(() => {});
      return;
    }
    await route.continue();
  });

  await page.clock.fastForward(10 * 60 * 1000);
  await expect.poll(() => preEditIntercepted).toBe(true);
  await rows.first().getByRole('button', { name: text.edit }).click();
  await rows.first().getByLabel(text.priority).selectOption('Emergency');
  await rows.first().getByRole('button', { name: text.save }).click();
  await expect(rows.first().getByLabel(text.priority)).toHaveCount(0);
  await expect(rows.first().locator('.portal-tier')).toHaveText(en.tiers.Emergency);
  releasePreEdit();
  await expect(rows.first().locator('.portal-tier')).toHaveText(en.tiers.Emergency);
  await page.unroute('**/v1/classifications');

  // Hold a pre-delete GET /v1/classifications while completing DELETE, then release the stale response.
  let releasePreDelete!: () => void;
  const preDeleteHeld = new Promise<void>(resolve => { releasePreDelete = resolve; });
  let preDeleteIntercepted = false;
  await page.route('**/v1/classifications', async route => {
    if (!preDeleteIntercepted && route.request().method() === 'GET') {
      preDeleteIntercepted = true;
      const response = await route.fetch();
      const body = await response.json();
      await preDeleteHeld;
      await route.fulfill({ response, json: body }).catch(() => {});
      return;
    }
    await route.continue();
  });

  await page.clock.fastForward(10 * 60 * 1000);
  await expect.poll(() => preDeleteIntercepted).toBe(true);
  await rows.first().getByRole('button', { name: text.delete }).click();
  await expect(page.getByText(text.emptyHistory)).toBeVisible();
  releasePreDelete();
  await expect(page.getByText(text.emptyHistory)).toBeVisible();
});

test('admin dashboard renders registered users and a localized notice when endpoints are omitted', async ({ page }) => {
  await page.route('**/v1/admin/dashboard', route => route.fulfill({
    json: {
      users: [{ id: 'legacy-admin', email: 'admin@example.test', role: 'admin', createdAt: '2026-11-24T17:15:00.000Z', requests: 5 }],
    },
  }));
  const pageErrors: string[] = [];
  page.on('pageerror', error => pageErrors.push(error.message));

  await page.goto('/login');
  await page.getByLabel(text.email).fill('admin@example.test');
  await page.getByLabel(text.password).fill('browser-test-only');
  await page.getByRole('button', { name: text.signIn }).click();
  await expect(page).toHaveURL('/admin');
  const endpointRegion = page.getByRole('region', { name: text.endpointStats });
  const usersRegion = page.getByRole('region', { name: text.accounts });
  await expect(endpointRegion).toContainText(text.endpointStatsUnavailable);
  await expect(usersRegion.getByRole('cell', { name: 'admin@example.test', exact: true })).toBeVisible();
  expect(pageErrors).toEqual([]);
});
