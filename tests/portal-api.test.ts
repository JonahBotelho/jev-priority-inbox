// Portal API contract: own-account login, protected role routes, inference and usage persistence.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import type { Server } from 'node:http';

process.env.MAIL_ENCRYPTION_KEY = '11'.repeat(32);
process.env.APP_JWT_SECRET = '22'.repeat(32);
process.env.INITIAL_ADMIN_EMAIL = 'root@example.test';
process.env.INITIAL_ADMIN_PASSWORD = 'admin-password-for-tests';
process.env.PUBLIC_URL = 'http://127.0.0.1:0';
process.env.CLIENT_ORIGIN = 'http://127.0.0.1:5173';
delete process.env.JEV_API_KEY;

import { Config } from '../src/server/config.js';
import { Database } from '../src/server/infrastructure/Database.js';
import { PortalApi } from '../src/server/application/PortalApi.js';

test('registration, login, JWT revocation, role authorization, classification and usage work', async () => {
  const database = new Database(':memory:');
  const config = new Config();
  const portal = new PortalApi(database, config, { async classify() { return { Emergency: 0.8, Urgent: 0.1, Routine: 0.1 }; } });
  await portal.bootstrapAdmin();
  const app = express(); app.use(express.json()); app.use('/v1', portal.router);
  const server: Server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}/v1`;
  const request = (path: string, method = 'GET', body?: unknown, cookie = '') => fetch(base + path, {
    method, headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(cookie ? { Cookie: cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  try {
    const created = await request('/auth/register', 'POST', { email: 'student@example.test', password: 'a-unique-student-password' });
    assert.equal(created.status, 201);
    const userCookie = created.headers.get('set-cookie')!.split(';')[0];
    const stored = database.connection.prepare('SELECT password_hash FROM app_users WHERE email=?').get('student@example.test') as { password_hash: string };
    assert.match(stored.password_hash, /^scrypt\$/);
    assert.equal((await request('/auth/me', 'GET', undefined, userCookie)).status, 200);
    assert.equal((await request('/admin/dashboard', 'GET', undefined, userCookie)).status, 403);

    const classified = await request('/classify', 'POST', { subject: 'Outage', text: 'Customers cannot pay.' }, userCookie);
    assert.equal(classified.status, 200);
    const result = await classified.json() as { tier: string; score: number; provider: string; model: string; durationMs: number };
    assert.deepEqual([result.tier, result.score, result.provider, result.model], ['Emergency', 85, 'Jev', 'jev-1.14.0']);
    const usage = await request('/usage/me', 'GET', undefined, userCookie);
    const summary = await usage.json() as { requests: number; successful: number; lastRequest: string };
    assert.equal(summary.requests, 1); assert.equal(summary.successful, 1); assert.ok(summary.lastRequest);
    const history = await request('/classifications', 'GET', undefined, userCookie);
    const records = await history.json() as { results: Array<{ tier: string; score: number }> };
    assert.deepEqual(records.results.map(record => [record.tier, record.score]), [['Emergency', 85]]);

    const badLogin = await request('/auth/login', 'POST', { email: 'student@example.test', password: 'wrong-password-123' });
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
