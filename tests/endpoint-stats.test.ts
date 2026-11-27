// Server-side API endpoint statistics: tracking, exclusions, route normalization, backfill and persistence.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { createPublicInboxApi } from '../src/server/http/PublicInboxApi.js';
import { PublicPriorityInbox } from '../src/server/application/PublicPriorityInbox.js';
import { PortalApi } from '../src/server/application/PortalApi.js';
import { EndpointStatsTracker } from '../src/server/application/EndpointStatsTracker.js';
import { PostgresPortal } from '../src/server/infrastructure/PostgresPortal.js';
import type { EndpointStat, PortalDashboard } from '../src/shared/portal.js';
import { createTestStore } from './postgres-fixture.js';

const testEnv = {
  APP_JWT_SECRET: '33'.repeat(32),
  INITIAL_ADMIN_EMAIL: 'stats-admin@example.test',
  INITIAL_ADMIN_PASSWORD: 'admin-password-stats',
  PUBLIC_URL: 'http://127.0.0.1:0',
  CLIENT_ORIGIN: 'http://127.0.0.1:5173',
};

function findStat(endpoints: EndpointStat[], method: string, endpoint: string): EndpointStat | undefined {
  return endpoints.find(item => item.method === method && item.endpoint === endpoint);
}

test('endpoint statistics track authorized functional routes, exclude auth/health/admin/401/403, and persist across restarts', async t => {
  const database = await createTestStore();
  t.after(() => database.pool.end());
  const inbox = await PublicPriorityInbox.open(database);
  const portal = await PortalApi.open(database, undefined, testEnv);
  const app = createPublicInboxApi(inbox, portal);

  // Verify parameterized routes normalize to their Express route template (e.g. :id).
  const extraRouter = express.Router();
  extraRouter.use(portal.endpointStats.track('/v1'));
  extraRouter.patch('/items/:id', (_req, res) => res.json({ ok: true }));
  extraRouter.delete('/items/:id', (_req, res) => res.sendStatus(204));
  app.use('/v1', extraRouter);
  app.get('/doc', (_req, res) => res.json({ openapi: '3.0.0' }));
  app.get('/doc/openapi.json', (_req, res) => res.json({ openapi: '3.0.0' }));

  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  const login = await fetch(`${origin}/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: testEnv.INITIAL_ADMIN_EMAIL, password: testEnv.INITIAL_ADMIN_PASSWORD }),
  });
  assert.equal(login.status, 200);
  const adminCookie = login.headers.get('set-cookie')!.split(';')[0];

  const initialDashboard = await fetch(`${origin}/v1/admin/dashboard`, { headers: { Cookie: adminCookie } });
  assert.equal(initialDashboard.status, 200);
  const initial = await initialDashboard.json() as PortalDashboard;
  assert.equal(initial.endpoints.length, EndpointStatsTracker.trackedCatalog.length);
  for (const stat of initial.endpoints) assert.equal(stat.requests, 0);

  // Trigger excluded traffic: health checks, docs, CORS preflight, 404, 401 and 403 rejections, auth/me.
  assert.equal((await fetch(`${origin}/v1/health`)).status, 200);
  assert.equal((await fetch(`${origin}/doc`)).status, 200);
  assert.equal((await fetch(`${origin}/doc/openapi.json`)).status, 200);
  assert.equal((await fetch(`${origin}/v1/unknown-route`)).status, 404);
  assert.equal((await fetch(`${origin}/v1/auth/me`, { headers: { Cookie: adminCookie } })).status, 200);
  assert.equal((await fetch(`${origin}/v1/classify`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status, 401);
  assert.equal((await fetch(`${origin}/v1/classifications`, { headers: { Origin: 'https://blocked.example' } })).status, 403);
  assert.equal((await fetch(`${origin}/v1/classify`, { method: 'OPTIONS', headers: { Origin: testEnv.CLIENT_ORIGIN } })).status, 204);

  // Trigger counted functional traffic, including query strings and parameterized routes.
  assert.equal((await fetch(`${origin}/v1/priority`)).status, 200);
  assert.equal((await fetch(`${origin}/v1/priority?include=routine`)).status, 200);
  assert.equal((await fetch(`${origin}/v1/classifications`, { headers: { Cookie: adminCookie } })).status, 200);
  assert.equal((await fetch(`${origin}/v1/usage/me`, { headers: { Cookie: adminCookie } })).status, 200);
  assert.equal((await fetch(`${origin}/v1/items/first-id`, { method: 'PATCH' })).status, 200);
  assert.equal((await fetch(`${origin}/v1/items/second-id`, { method: 'PATCH' })).status, 200);
  assert.equal((await fetch(`${origin}/v1/items/third-id`, { method: 'DELETE' })).status, 204);

  const updatedDashboard = await fetch(`${origin}/v1/admin/dashboard`, { headers: { Cookie: adminCookie } });
  const updated = await updatedDashboard.json() as PortalDashboard;
  assert.equal(findStat(updated.endpoints, 'GET', '/v1/priority')?.requests, 2);
  assert.equal(findStat(updated.endpoints, 'GET', '/v1/classifications')?.requests, 1);
  assert.equal(findStat(updated.endpoints, 'GET', '/v1/usage/me'), undefined);
  assert.equal(findStat(updated.endpoints, 'PATCH', '/v1/items/:id')?.requests, 2);
  assert.equal(findStat(updated.endpoints, 'DELETE', '/v1/items/:id')?.requests, 1);
  assert.equal(findStat(updated.endpoints, 'POST', '/v1/classify')?.requests, 0);
  assert.equal(updated.users.find(user => user.email === testEnv.INITIAL_ADMIN_EMAIL)?.requests, 1);
  assert.equal(findStat(updated.endpoints, 'GET', '/v1/health'), undefined);
  assert.equal(findStat(updated.endpoints, 'GET', '/v1/auth/me'), undefined);
  assert.equal(findStat(updated.endpoints, 'POST', '/v1/auth/login'), undefined);
  assert.equal(findStat(updated.endpoints, 'GET', '/v1/admin/dashboard'), undefined);
  assert.equal(findStat(updated.endpoints, 'GET', '/doc'), undefined);
  assert.equal(findStat(updated.endpoints, 'GET', '/doc/openapi.json'), undefined);

  // Re-opening PortalApi against the same database retains persisted counts.
  const restartedPortal = await PortalApi.open(database, undefined, testEnv);
  const restartedServer = createPublicInboxApi(inbox, restartedPortal).listen(0, '127.0.0.1');
  await new Promise<void>(resolve => restartedServer.once('listening', resolve));
  t.after(() => { restartedServer.closeAllConnections(); restartedServer.close(); });
  const restartedOrigin = `http://127.0.0.1:${(restartedServer.address() as AddressInfo).port}`;

  const persistedResponse = await fetch(`${restartedOrigin}/v1/admin/dashboard`, { headers: { Cookie: adminCookie } });
  const persisted = await persistedResponse.json() as PortalDashboard;
  assert.equal(findStat(persisted.endpoints, 'GET', '/v1/priority')?.requests, 2);
  assert.equal(findStat(persisted.endpoints, 'PATCH', '/v1/items/:id')?.requests, 2);
});

test('migration seeds historical api_usage totals into api_endpoint_stats once without double-counting', async t => {
  const database = await createTestStore();
  t.after(() => database.pool.end());

  // Initialize tables, clear stats to simulate upgrading an existing production database with api_usage history.
  await PortalApi.open(database, undefined, testEnv);
  const { rows: [admin] } = await database.pool.query<{ id: string }>(
    'SELECT id FROM app_users WHERE email=$1',
    [testEnv.INITIAL_ADMIN_EMAIL],
  );
  await database.pool.query(
    `INSERT INTO api_usage (id, user_id, endpoint, status)
     VALUES ('00000000-0000-4000-8000-000000000001', $1, '/v1/demo/inference', 200),
            ('00000000-0000-4000-8000-000000000002', $1, '/v1/demo/inference', 200),
            ('00000000-0000-4000-8000-000000000003', $1, '/v1/classify', 200)`,
    [admin.id],
  );
  await database.pool.query('DELETE FROM api_endpoint_stats');
  await database.pool.query('DELETE FROM api_user_endpoint_stats');

  // Re-open twice: first startup backfills, second startup does not duplicate counts.
  await PortalApi.open(database, undefined, testEnv);
  await PortalApi.open(database, undefined, testEnv);

  const { rows } = await database.pool.query<EndpointStat>(
    'SELECT method, endpoint, requests FROM api_endpoint_stats ORDER BY endpoint ASC',
  );
  assert.deepEqual(rows, [
    { method: 'POST', endpoint: '/v1/classify', requests: 1 },
    { method: 'POST', endpoint: '/v1/demo/inference', requests: 2 },
  ]);
  const { rows: userRows } = await database.pool.query<{ requests: number }>(
    'SELECT COALESCE(SUM(requests), 0)::int AS requests FROM api_user_endpoint_stats WHERE user_id=$1',
    [admin.id],
  );
  assert.equal(userRows[0].requests, 3);
});

test('authenticated counter writes roll back api_endpoint_stats when api_user_endpoint_stats fails', async t => {
  const database = await createTestStore();
  t.after(() => database.pool.end());
  const store = await PostgresPortal.open(database);

  // Seed one valid public hit so we verify the pre-existing count stays unchanged on rollback.
  await store.recordEndpointHit('POST', '/v1/classify');
  const before = await database.pool.query<{ requests: number }>(
    "SELECT requests FROM api_endpoint_stats WHERE method='POST' AND endpoint='/v1/classify'",
  );
  assert.equal(before.rows[0].requests, 1);

  // Force the second write (api_user_endpoint_stats) to fail with an FK violation on nonexistent user_id.
  await assert.rejects(
    () => store.recordEndpointHit('POST', '/v1/classify', '00000000-0000-4000-8000-000000000999'),
    /foreign key|23503/i,
  );

  const after = await database.pool.query<{ requests: number }>(
    "SELECT requests FROM api_endpoint_stats WHERE method='POST' AND endpoint='/v1/classify'",
  );
  assert.equal(after.rows[0].requests, 1);
  const userRows = await database.pool.query(
    'SELECT * FROM api_user_endpoint_stats WHERE user_id=$1',
    ['00000000-0000-4000-8000-000000000999'],
  );
  assert.equal(userRows.rows.length, 0);
});

test('usage endpoint detects 20 free calls exhausted, emits headers, and continues serving requests', async t => {
  const database = await createTestStore();
  t.after(() => database.pool.end());
  const inbox = await PublicPriorityInbox.open(database);
  const portal = await PortalApi.open(database, undefined, testEnv);
  const server = createPublicInboxApi(inbox, portal).listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  const reg = await fetch(`${origin}/v1/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'quota-user@example.test', password: 'quota-password' }),
  });
  assert.equal(reg.status, 201);
  const cookie = reg.headers.get('set-cookie')!.split(';')[0];

  for (let i = 1; i <= 21; i++) {
    const res = await fetch(`${origin}/v1/classifications`, { headers: { Cookie: cookie } });
    assert.equal(res.status, 200);
    await portal.endpointStats.flush();
    assert.equal(res.headers.get('x-api-usage-count'), String(i));
    assert.equal(res.headers.get('x-api-free-limit'), '20');
    assert.equal(res.headers.get('x-api-limit-exceeded'), String(i >= 20));
  }

  const usageRes = await fetch(`${origin}/v1/usage/me`, { headers: { Cookie: cookie } });
  assert.equal(usageRes.status, 200);
  const usage = await usageRes.json();
  assert.equal(usage.requests, 21);
  assert.equal(usage.freeLimit, 20);
  assert.equal(usage.remainingFreeCalls, 0);
  assert.equal(usage.limitExceeded, true);
  assert.ok(typeof usage.warning === 'string' && usage.warning.includes('20'));

  // Calling /v1/usage/me again must not increment the user's count.
  const secondRead = await (await fetch(`${origin}/v1/usage/me`, { headers: { Cookie: cookie } })).json();
  assert.equal(secondRead.requests, 21);

  // Two concurrent requests starting at 18 for a second user commit sequentially as 19 and 20.
  const reg2 = await fetch(`${origin}/v1/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'concurrent-quota@example.test', password: 'quota-password' }),
  });
  assert.equal(reg2.status, 201);
  const cookie2 = reg2.headers.get('set-cookie')!.split(';')[0];
  const { rows: [user2] } = await database.pool.query<{ id: string }>(
    "SELECT id FROM app_users WHERE email='concurrent-quota@example.test'",
  );
  await database.pool.query(
    "INSERT INTO api_user_endpoint_stats (user_id, method, endpoint, requests) VALUES ($1, 'POST', '/v1/classify', 18)",
    [user2.id],
  );
  const [first, second] = await Promise.all([
    fetch(`${origin}/v1/classifications`, { headers: { Cookie: cookie2 } }),
    fetch(`${origin}/v1/classifications`, { headers: { Cookie: cookie2 } }),
  ]);
  assert.deepEqual([first.status, second.status], [200, 200]);
  assert.deepEqual(
    [first.headers.get('x-api-usage-count'), second.headers.get('x-api-usage-count')].sort(),
    ['19', '20'],
  );
  assert.deepEqual(
    [first.headers.get('x-api-limit-exceeded'), second.headers.get('x-api-limit-exceeded')].sort(),
    ['false', 'true'],
  );
});

test('upgrading a database with historical GET /v1/usage/me rows removes quota checks and preserves eligible totals', async t => {
  const database = await createTestStore();
  t.after(() => database.pool.end());
  const inbox = await PublicPriorityInbox.open(database);
  await PortalApi.open(database, undefined, testEnv);

  const { rows: [admin] } = await database.pool.query<{ id: string }>(
    'SELECT id FROM app_users WHERE email=$1',
    [testEnv.INITIAL_ADMIN_EMAIL],
  );
  // Seed historical GET /v1/usage/me rows alongside eligible functional endpoint rows.
  await database.pool.query(
    `INSERT INTO api_endpoint_stats (method, endpoint, requests)
     VALUES ('GET', '/v1/usage/me', 15), ('POST', '/v1/classify', 3), ('GET', '/v1/classifications', 2)
     ON CONFLICT (method, endpoint) DO UPDATE SET requests = EXCLUDED.requests`,
  );
  await database.pool.query(
    `INSERT INTO api_user_endpoint_stats (user_id, method, endpoint, requests)
     VALUES ($1, 'GET', '/v1/usage/me', 15), ($1, 'POST', '/v1/classify', 3), ($1, 'GET', '/v1/classifications', 2)
     ON CONFLICT (user_id, method, endpoint) DO UPDATE SET requests = EXCLUDED.requests`,
    [admin.id],
  );

  // Re-open PortalApi (simulating deploying the upgraded migration) and verify all views agree on 5.
  const upgradedPortal = await PortalApi.open(database, undefined, testEnv);
  const server = createPublicInboxApi(inbox, upgradedPortal).listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  const login = await fetch(`${origin}/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: testEnv.INITIAL_ADMIN_EMAIL, password: testEnv.INITIAL_ADMIN_PASSWORD }),
  });
  assert.equal(login.status, 200);
  const cookie = login.headers.get('set-cookie')!.split(';')[0];

  const meRes = await fetch(`${origin}/v1/auth/me`, { headers: { Cookie: cookie } });
  assert.equal(meRes.headers.get('x-api-usage-count'), '5');
  assert.equal(meRes.headers.get('x-api-limit-exceeded'), 'false');

  const usageRes = await fetch(`${origin}/v1/usage/me`, { headers: { Cookie: cookie } });
  const usage = await usageRes.json();
  assert.equal(usage.requests, 5);
  assert.equal(usage.limitExceeded, false);

  const dashboard = await (await fetch(`${origin}/v1/admin/dashboard`, { headers: { Cookie: cookie } })).json() as PortalDashboard;
  assert.equal(dashboard.users.find(user => user.email === testEnv.INITIAL_ADMIN_EMAIL)?.requests, 5);
  assert.equal(findStat(dashboard.endpoints, 'GET', '/v1/usage/me'), undefined);
  assert.equal(findStat(dashboard.endpoints, 'POST', '/v1/classify')?.requests, 3);
  assert.equal(findStat(dashboard.endpoints, 'GET', '/v1/classifications')?.requests, 2);
});
