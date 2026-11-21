// Portal API contract: own-account login, protected role routes, inference and usage persistence.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import type { Server } from 'node:http';
import classifyOnNetlify from '../netlify/functions/jev-classify.js';
import { jevModel, urgencyRubric } from '../src/shared/jev.js';

process.env.MAIL_ENCRYPTION_KEY = '11'.repeat(32);
process.env.APP_JWT_SECRET = '22'.repeat(32);
process.env.INITIAL_ADMIN_EMAIL = 'root@example.test';
process.env.INITIAL_ADMIN_PASSWORD = 'admin-password-for-tests';
process.env.PUBLIC_URL = 'http://127.0.0.1:0';
process.env.CLIENT_ORIGIN = 'http://127.0.0.1:5173';
const functionUrl = 'https://function.example.test/.netlify/functions/jev-classify';
const gatewayBase = 'https://gateway.example.test/typesafe';

import { Config } from '../src/server/config.js';
import { Database } from '../src/server/infrastructure/Database.js';
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
  const database = new Database(':memory:');
  const config = new Config();
  const portal = new PortalApi(database, config);
  await portal.bootstrapAdmin();
  const app = express(); app.use(express.json()); app.use('/v1', portal.router);
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
    const tooShort = await request('/auth/register', 'POST', { email: 'short@example.test', password: '12' });
    assert.equal(tooShort.status, 400);
    const created = await request('/auth/register', 'POST', { email: 'john@john.com', password: '123' });
    assert.equal(created.status, 201);
    const userCookie = created.headers.get('set-cookie')!.split(';')[0];
    const stored = database.connection.prepare('SELECT password_hash FROM app_users WHERE email=?').get('john@john.com') as { password_hash: string };
    assert.match(stored.password_hash, /^scrypt\$/);
    assert.equal((await request('/auth/me', 'GET', undefined, userCookie)).status, 200);
    assert.equal((await request('/admin/dashboard', 'GET', undefined, userCookie)).status, 403);

    const message = { subject: 'Outage', text: 'Customers cannot pay. '.repeat(75).trim(),
      receivedAt: 'yesterday', model: 'other', privateField: 'omit' };
    assert.equal((await request('/classify', 'POST', message)).status, 401);
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
    const summary = await usage.json() as { requests: number; successful: number; lastRequest: string };
    assert.equal(summary.requests, 1); assert.equal(summary.successful, 1); assert.ok(summary.lastRequest);
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

    const badLogin = await request('/auth/login', 'POST', { email: 'john@john.com', password: 'wrong-password-123' });
    assert.equal(badLogin.status, 401);
    const adminLogin = await request('/auth/login', 'POST', { email: 'root@example.test', password: 'admin-password-for-tests' });
    assert.equal(adminLogin.status, 200);
    const adminCookie = adminLogin.headers.get('set-cookie')!.split(';')[0];
    const dashboard = await request('/admin/dashboard', 'GET', undefined, adminCookie);
    assert.equal(dashboard.status, 200);
    assert.equal((await dashboard.json() as { users: unknown[] }).users.length, 2);
    const selfDemotion = await request('/admin/users/' + (await adminLogin.json() as { id: string }).id, 'PATCH', { role: 'user' }, adminCookie);
    assert.equal(selfDemotion.status, 409);

    assert.equal((await request('/auth/logout', 'POST', {}, userCookie)).status, 204);
    assert.equal((await request('/auth/me', 'GET', undefined, userCookie)).status, 401);
  } finally {
    server.close(); server.closeAllConnections(); database.connection.close();
  }
});
