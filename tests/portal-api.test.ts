// Portal API contract: own-account login, protected role routes, inference and usage persistence.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import classifyOnNetlify from '../netlify/functions/jev-classify.js';
import { jevModel, urgencyRubric } from '../src/shared/jev.js';
import type { PortalUsage } from '../src/shared/portal.js';

process.env.APP_JWT_SECRET = '22'.repeat(32);
process.env.INITIAL_ADMIN_EMAIL = 'root@example.test';
process.env.INITIAL_ADMIN_PASSWORD = 'admin-password-for-tests';
process.env.PUBLIC_URL = 'http://127.0.0.1:0';
process.env.CLIENT_ORIGIN = 'http://127.0.0.1:5173';
const functionUrl = 'https://function.example.test/.netlify/functions/jev-classify';
const gatewayBase = 'https://gateway.example.test/typesafe';

import { createTestStore } from './postgres-fixture.js';
import { createPublicInboxApi } from '../src/server/http/PublicInboxApi.js';
import { PublicPriorityInbox } from '../src/server/application/PublicPriorityInbox.js';
import { JevClassifier } from '../src/server/adapters/Providers.js';
import { PortalApi } from '../src/server/application/PortalApi.js';

test('registration, login, JWT revocation, role authorization, Netlify classification and usage work', async t => {
  const originalEnv = process.env;
  t.after(() => { process.env = originalEnv; });
  process.env = { ...originalEnv, JEV_FUNCTION_URL: functionUrl, JEV_FUNCTION_SECRET: 'test-render-to-netlify',
    TYPESAFE_API_KEY: 'test-netlify-to-gateway', TYPESAFE_BASE_URL: gatewayBase };
  const portalFetch = globalThis.fetch;
  const outbound: Request[] = [];
  let gatewayStatus = 200;
  t.mock.method(globalThis, 'fetch', async (resource: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(resource, init);
    outbound.push(request.clone());
    if (request.url === functionUrl) return classifyOnNetlify(request);
    assert.equal(request.url, gatewayBase + '/v1/systemone');
    if (gatewayStatus !== 200) return new Response('private provider diagnostic', { status: gatewayStatus });
    return Response.json({
      model: jevModel, answers: { urgency: { type: 'choice', choice: 'Emergency', confidence: 0.8,
        probabilities: { Emergency: 0.8, Urgent: 0.1, Routine: 0.1 } } },
      usage: { input_tokens: 150, output_tokens: 10 },
    });
  });
  const database = await createTestStore();
  const portal = await PortalApi.open(database, JevClassifier.fromEnvironment());
  const inbox = await PublicPriorityInbox.open(database);
  const app = createPublicInboxApi(inbox, portal);
  const server: Server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}/v1`;
  const request = (path: string, method = 'GET', body?: unknown, cookie = '') => portalFetch(base + path, {
    method, headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(cookie ? { Cookie: cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  try {
    const origin = process.env.CLIENT_ORIGIN!;
    const preflight = await portalFetch(base + '/auth/login', { method: 'OPTIONS', headers: { Origin: origin, 'Access-Control-Request-Method': 'POST' } });
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers.get('access-control-allow-origin'), origin);
    assert.equal(preflight.headers.get('access-control-allow-credentials'), 'true');
    assert.equal(preflight.headers.get('access-control-max-age'), '600');
    assert.equal(preflight.headers.get('timing-allow-origin'), origin);
    assert.equal((await portalFetch(base + '/auth/me', { headers: { Origin: 'https://other.example' } })).status, 403);
    const publicRead = await portalFetch(base + '/priority', { headers: { Origin: 'https://other.example' } });
    assert.equal(publicRead.status, 200);
    assert.equal(publicRead.headers.get('access-control-allow-origin'), '*');
    assert.equal((await request('/admin/dashboard')).status, 401);
    const tooShort = await request('/auth/register', 'POST', { email: 'short@example.test', password: '12' });
    assert.equal(tooShort.status, 400);
    const created = await request('/auth/register', 'POST', { email: 'Member@example.test', password: '123', role: 'admin' });
    assert.equal(created.status, 201);
    const userCookie = created.headers.get('set-cookie')!.split(';')[0];
    assert.equal((await created.json()).role, 'user');
    assert.match(created.headers.get('set-cookie')!, /HttpOnly/);
    const { rows: [stored] } = await database.pool.query('SELECT password_hash FROM app_users WHERE email=$1', ['member@example.test']);
    assert.match(stored.password_hash, /^scrypt\$/);
    assert.equal((await request('/auth/me', 'GET', undefined, userCookie)).status, 200);
    assert.equal((await request('/admin/dashboard', 'GET', undefined, userCookie)).status, 403);

    const message = { subject: 'Outage', text: 'Customers cannot pay. '.repeat(75).trim(),
      receivedAt: 'yesterday', model: 'other', privateField: 'omit' };
    assert.equal((await request('/classify', 'POST', message)).status, 401);
    assert.equal((await request('/classify', 'POST', {}, userCookie)).status, 400);
    const initialUsage = await (await request('/usage/me', 'GET', undefined, userCookie)).json();
    assert.equal(initialUsage.requests, 0);
    assert.equal(initialUsage.netlifyCreditBalance, null);
    const checkedAt = '2026-11-10T12:30:00.000Z';
    await database.pool.query('INSERT INTO netlify_credit_checks (remaining_credits,checked_at) VALUES ($1,$2)', ['17.6250', checkedAt]);
    // Backfilling an older observation must not replace the latest verified balance.
    await database.pool.query("INSERT INTO netlify_credit_checks VALUES ('2026-11-01T12:30:00Z', 90)");
    assert.equal(outbound.length, 0);
    const classified = await request('/classify', 'POST', message, userCookie);
    assert.equal(classified.status, 200);
    const result = await classified.json() as { tier: string; score: number; provider: string; model: string; durationMs: number };
    assert.deepEqual([result.tier, result.score, result.provider, result.model], ['Emergency', 85, 'Jev', 'jev-1.14.0']);
    assert.equal(outbound.length, 2);
    assert.equal(outbound[0].headers.get('Authorization'), 'Bearer test-render-to-netlify');
    assert.equal(outbound[0].headers.get('Cookie'), null);
    assert.equal(outbound[1].headers.get('Authorization'), 'Bearer test-netlify-to-gateway');
    assert.equal(outbound[1].headers.get('Content-Encoding'), null);
    const forwarded = await outbound[0].json();
    assert.deepEqual(forwarded, {
      subject: message.subject, text: message.text, receivedAt: new Date(forwarded.receivedAt).toISOString(),
      role: 'On-call service owner', timeZone: 'America/Vancouver',
    });
    const inference = await outbound[1].json();
    assert.equal(inference.model, jevModel);
    assert.deepEqual(inference.state, forwarded);
    assert.deepEqual(inference.questions, { urgency: { type: 'choice', instructions: urgencyRubric,
      criteria: { Emergency: null, Urgent: null, Routine: null } } });
    const usage = await request('/usage/me', 'GET', undefined, userCookie);
    const summary = await usage.json() as PortalUsage;
    assert.equal(summary.requests, 1); assert.equal(summary.successful, 1); assert.ok(summary.lastRequest);
    assert.ok(summary.netlifyCreditBalance);
    assert.equal(summary.netlifyCreditBalance.remaining, '17.625');
    assert.equal(new Date(summary.netlifyCreditBalance.checkedAt).toISOString(), checkedAt);
    const history = await request('/classifications', 'GET', undefined, userCookie);
    const records = await history.json() as { results: Array<{ tier: string; score: number }> };
    assert.deepEqual(records.results.map(record => [record.tier, record.score]), [['Emergency', 85]]);

    gatewayStatus = 429;
    const failed = await request('/classify', 'POST', message, userCookie);
    assert.equal(failed.status, 502);
    assert.doesNotMatch(await failed.text(), /private provider diagnostic|test-netlify-to-gateway/);
    const afterFailure = await (await request('/usage/me', 'GET', undefined, userCookie)).json();
    assert.deepEqual([afterFailure.requests, afterFailure.successful], [2, 1]);
    assert.equal((await (await request('/classifications', 'GET', undefined, userCookie)).json()).results.length, 1);

    const duplicates = await Promise.all(['other@example.test', 'OTHER@example.test'].map(email =>
      request('/auth/register', 'POST', { email, password: 'other-password' })));
    assert.deepEqual(duplicates.map(res => res.status).sort(), [201,409]);
    const otherCookie = duplicates.find(res => res.status === 201)!.headers.get('set-cookie')!.split(';')[0];
    const otherUsage = await (await request('/usage/me', 'GET', undefined, otherCookie)).json();
    assert.equal(otherUsage.requests, 0);
    assert.deepEqual(otherUsage.netlifyCreditBalance, summary.netlifyCreditBalance);
    assert.deepEqual((await (await request('/classifications', 'GET', undefined, otherCookie)).json()).results, []);
    await database.pool.query("INSERT INTO netlify_credit_checks VALUES ('2026-11-11T12:30:00Z', 0)");
    const latestUsage = await (await request('/usage/me', 'GET', undefined, userCookie)).json();
    assert.equal(latestUsage.netlifyCreditBalance.remaining, '0');
    assert.equal(latestUsage.requests, 2);

    const badLogin = await request('/auth/login', 'POST', { email: 'member@example.test', password: 'wrong-password-123' });
    assert.equal(badLogin.status, 401);
    const adminLogin = await request('/auth/login', 'POST', { email: 'root@example.test', password: 'admin-password-for-tests' });
    assert.equal(adminLogin.status, 200);
    const adminCookie = adminLogin.headers.get('set-cookie')!.split(';')[0];
    const dashboard = await request('/admin/dashboard', 'GET', undefined, adminCookie);
    assert.equal(dashboard.status, 200);
    const { users, endpoints } = await dashboard.json();
    assert.equal(users.length, 3);
    assert.equal(users.find((user: {email: string}) => user.email === 'member@example.test').requests, 9);
    assert.equal(users.find((user: {email: string}) => user.email === 'other@example.test').requests, 2);
    assert.equal(users.find((user: {email: string}) => user.email === 'root@example.test').requests, 0);
    assert.deepEqual(Object.keys(users[0]).sort(), ['id','email','role','createdAt','requests'].sort());
    assert.ok(Array.isArray(endpoints));
    assert.equal(endpoints.find((stat: { method: string; endpoint: string }) => stat.method === 'POST' && stat.endpoint === '/v1/classify')?.requests, 3);
    assert.equal(endpoints.find((stat: { method: string; endpoint: string }) => stat.method === 'GET' && stat.endpoint === '/v1/priority')?.requests, 1);
    assert.equal(endpoints.find((stat: { method: string; endpoint: string }) => stat.method === 'GET' && stat.endpoint === '/v1/usage/me')?.requests, 5);
    assert.equal(endpoints.find((stat: { method: string; endpoint: string }) => stat.method === 'GET' && stat.endpoint === '/v1/classifications')?.requests, 3);
    assert.equal(endpoints.find((stat: { method: string; endpoint: string }) => stat.endpoint === '/v1/auth/login'), undefined);
    assert.equal(endpoints.find((stat: { method: string; endpoint: string }) => stat.endpoint === '/v1/admin/dashboard'), undefined);
    const selfDemotion = await request('/admin/users/' + (await adminLogin.json() as { id: string }).id, 'PATCH', { role: 'user' }, adminCookie);
    assert.equal(selfDemotion.status, 404); // The live administrator list is read-only.

    assert.equal((await request('/auth/logout', 'POST', {}, userCookie)).status, 204);
    assert.equal((await request('/auth/me', 'GET', undefined, userCookie)).status, 401);
  } finally {
    server.close(); server.closeAllConnections(); await database.pool.end();
  }
});

test('concurrent portal instances reuse the Neon signing key and check session expiration in PostgreSQL', async t => {
  const db = await createTestStore();
  const inbox = await PublicPriorityInbox.open(db);
  const env = { PUBLIC_URL: 'https://api.example.test', CLIENT_ORIGIN: 'https://client.example.test/',
    INITIAL_ADMIN_EMAIL: 'seed@example.test', INITIAL_ADMIN_PASSWORD: 'initial-password' };
  const portals = await Promise.all([PortalApi.open(db, undefined, env), PortalApi.open(db, undefined, env)]);
  const servers = portals.map(portal => createPublicInboxApi(inbox, portal).listen(0, '127.0.0.1'));
  t.after(async () => {
    await Promise.all(servers.map(server => new Promise<void>(resolve => { server.close(() => resolve()); server.closeAllConnections(); })));
    await db.pool.end();
  });
  await Promise.all(servers.map(server => new Promise<void>(resolve => server.once('listening', resolve))));
  const [first, second] = servers.map(server => {
    const address = server.address(); assert.ok(address && typeof address !== 'string');
    return 'http://127.0.0.1:' + address.port + '/v1';
  });
  const registration = (email: string) => fetch(first + '/auth/register', { method: 'POST',
    headers: { Origin: 'https://client.example.test', 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'isolated-password' }) });
  assert.equal((await registration('SEED@example.test')).status, 409);
  const created = await registration('shared@example.test'); assert.equal(created.status, 201);
  const setCookie = created.headers.get('set-cookie')!;
  for (const flag of ['HttpOnly','Secure','SameSite=None','Partitioned']) assert.ok(setCookie.includes(flag));
  const headers = { Cookie: setCookie.split(';')[0], Origin: 'https://client.example.test' };
  assert.equal((await fetch(second + '/auth/me', {headers})).status, 200);
  const id = (await created.json()).id;
  await db.pool.query("UPDATE app_sessions SET expires_at=now()-interval '1 second' WHERE user_id=$1", [id]);
  assert.equal((await fetch(first + '/auth/me', {headers})).status, 401);
  assert.equal((await db.pool.query('SELECT count(*)::int AS keys FROM app_portal_signing_key')).rows[0].keys, 1);
  assert.equal((await db.pool.query("SELECT count(*)::int AS admins FROM app_users WHERE role='admin'")).rows[0].admins, 1);
});
