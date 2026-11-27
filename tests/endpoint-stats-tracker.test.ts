// Standalone Express 5 unit tests for EndpointStatsTracker without requiring PostgreSQL binaries.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { EndpointStatsTracker } from '../src/server/application/EndpointStatsTracker.js';

test('EndpointStatsTracker records normalized Express routes, per-user attribution, filters exclusions and 401/403, and merges the catalog', async t => {
  const counts = new Map<string, number>();
  const userCounts = new Map<string, number>();
  const tracker = new EndpointStatsTracker({
    async recordEndpointHit(method: string, endpoint: string, userId?: string) {
      await new Promise(resolve => setTimeout(resolve, 10));
      const key = `${method} ${endpoint}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
      if (userId) userCounts.set(userId, (userCounts.get(userId) ?? 0) + 1);
    },
  });

  const app = express();
  app.use(tracker.track());
  app.get('/v1/health', (_req, res) => res.json({ status: 'ok' }));
  app.get('/v1/priority', (_req, res) => res.json({ cards: [] }));
  app.get('/doc', (_req, res) => res.json({ openapi: '3.0.0' }));
  app.get('/doc/openapi.json', (_req, res) => res.json({ openapi: '3.0.0' }));

  const portal = express.Router();
  portal.use(tracker.track('/v1'));
  portal.post('/auth/login', (_req, res) => res.json({ ok: true }));
  portal.get('/auth/me', (_req, res) => res.json({ ok: true }));
  portal.post('/demo/inference', (req, res) => {
    const uid = req.get('x-auth');
    if (!uid) { res.sendStatus(401); return; }
    res.locals.user = { id: uid };
    res.json({ ok: true });
  });
  portal.patch('/items/:id', (req, res) => {
    if (req.get('x-forbid')) { res.sendStatus(403); return; }
    const uid = req.get('x-auth');
    if (uid) res.locals.user = { id: uid };
    res.json({ id: req.params.id });
  });
  portal.delete('/items/:id', (req, res) => {
    const uid = req.get('x-auth');
    if (uid) res.locals.user = { id: uid };
    res.sendStatus(204);
  });
  portal.get('/admin/dashboard', async (_req, res) => {
    await tracker.flush();
    const stored = [...counts.entries()].map(([key, requests]) => {
      const [method, endpoint] = key.split(' ');
      return { method, endpoint, requests };
    });
    res.json({ endpoints: tracker.mergeWithCatalog(stored), users: Object.fromEntries(userCounts) });
  });
  app.use('/v1', portal);

  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  // Excluded routes and unauthorized rejections must not increment counts.
  await fetch(`${origin}/v1/health`);
  await fetch(`${origin}/doc`);
  await fetch(`${origin}/doc/openapi.json`);
  await fetch(`${origin}/v1/does-not-exist`);
  await fetch(`${origin}/v1/auth/login`, { method: 'POST' });
  await fetch(`${origin}/v1/auth/me`);
  await fetch(`${origin}/v1/demo/inference`, { method: 'POST' });
  await fetch(`${origin}/v1/items/abc`, { method: 'PATCH', headers: { 'x-forbid': '1', 'x-auth': 'user-a' } });
  await fetch(`${origin}/v1/priority`, { method: 'HEAD' });

  // Authorized functional routes (including query strings and route params) must be counted.
  await fetch(`${origin}/v1/priority`);
  await fetch(`${origin}/v1/priority?include=routine`);
  await fetch(`${origin}/v1/demo/inference`, { method: 'POST', headers: { 'x-auth': 'user-a' } });
  await fetch(`${origin}/v1/items/one`, { method: 'PATCH', headers: { 'x-auth': 'user-a' } });
  await fetch(`${origin}/v1/items/two`, { method: 'PATCH', headers: { 'x-auth': 'user-b' } });
  await fetch(`${origin}/v1/items/three`, { method: 'DELETE', headers: { 'x-auth': 'user-a' } });

  const response = await fetch(`${origin}/v1/admin/dashboard`);
  assert.equal(response.status, 200);
  const { endpoints, users } = await response.json() as {
    endpoints: Array<{ method: string; endpoint: string; requests: number }>;
    users: Record<string, number>;
  };

  const countOf = (method: string, endpoint: string) =>
    endpoints.find(item => item.method === method && item.endpoint === endpoint)?.requests;

  assert.equal(countOf('GET', '/v1/priority'), 2);
  assert.equal(countOf('POST', '/v1/demo/inference'), 1);
  assert.equal(countOf('PATCH', '/v1/items/:id'), 2);
  assert.equal(countOf('DELETE', '/v1/items/:id'), 1);
  // Per-user attribution sums all authenticated functional endpoints and excludes public/rejected calls.
  assert.equal(users['user-a'], 3);
  assert.equal(users['user-b'], 1);
  // Tracked catalog routes without traffic still appear with 0 counts.
  assert.equal(countOf('POST', '/v1/classify'), 0);
  assert.equal(countOf('GET', '/v1/classifications'), 0);
  assert.equal(countOf('POST', '/v1/inbound'), 0);
  assert.equal(countOf('POST', '/v1/demo/receipts'), 0);
  // Excluded routes never appear.
  assert.equal(countOf('GET', '/v1/health'), undefined);
  assert.equal(countOf('POST', '/v1/auth/login'), undefined);
  assert.equal(countOf('GET', '/v1/auth/me'), undefined);
  assert.equal(countOf('GET', '/v1/usage/me'), undefined);
  assert.equal(countOf('GET', '/v1/admin/dashboard'), undefined);
  assert.equal(countOf('GET', '/doc'), undefined);
  assert.equal(countOf('GET', '/doc/openapi.json'), undefined);
  // Sorted descending by requests.
  assert.equal(endpoints[0].requests, 2);
  assert.equal(endpoints[endpoints.length - 1].requests, 0);
});

test('EndpointStatsTracker logs write failures without leaking request payloads or breaking responses', async t => {
  const logged: unknown[][] = [];
  t.mock.method(console, 'error', (...args: unknown[]) => { logged.push(args); });

  const tracker = new EndpointStatsTracker({
    async recordEndpointHit() {
      throw Object.assign(new Error('FK violation'), { code: '23503' });
    },
  });

  const app = express();
  app.use(express.json());
  const portal = express.Router();
  portal.use(tracker.track('/v1'));
  portal.post('/classify', (_req, res) => {
    res.locals.user = { id: 'missing-user-id' };
    res.json({ ok: true });
  });
  app.use('/v1', portal);

  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  const secretBody = { subject: 'PRIVATE-SUBJECT-12345', text: 'CONFIDENTIAL-BODY-67890' };
  const res = await fetch(`${origin}/v1/classify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(secretBody),
  });
  assert.equal(res.status, 200);
  await tracker.flush();

  assert.equal(logged.length, 1);
  const message = logged[0].map(String).join(' ');
  assert.match(message, /POST \/v1\/classify/);
  assert.match(message, /23503/);
  assert.doesNotMatch(message, /PRIVATE-SUBJECT-12345|CONFIDENTIAL-BODY-67890/);
});
