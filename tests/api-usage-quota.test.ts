// Standalone unit tests for 20 free API calls quota, committed headers, concurrency, failure handling, and scoped flush.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { buildUsageQuota, freeApiCallLimit } from '../src/shared/portal.js';
import { EndpointStatsTracker } from '../src/server/application/EndpointStatsTracker.js';

test('buildUsageQuota computes remaining free calls and threshold boundaries cleanly', () => {
  assert.equal(freeApiCallLimit, 20);
  assert.deepEqual(buildUsageQuota(0), { requests: 0, freeLimit: 20, remainingFreeCalls: 20, limitExceeded: false });
  assert.deepEqual(buildUsageQuota(19), { requests: 19, freeLimit: 20, remainingFreeCalls: 1, limitExceeded: false });
  assert.deepEqual(buildUsageQuota(20), { requests: 20, freeLimit: 20, remainingFreeCalls: 0, limitExceeded: true });
  assert.deepEqual(buildUsageQuota(25), { requests: 25, freeLimit: 20, remainingFreeCalls: 0, limitExceeded: true });
  assert.deepEqual(buildUsageQuota(-5), { requests: 0, freeLimit: 20, remainingFreeCalls: 20, limitExceeded: false });
});

test('EndpointStatsTracker emits committed X-API-* headers, handles concurrent 18->20 calls and failed writes, and excludes usage/403', async t => {
  t.mock.method(console, 'error', () => {});
  let userCalls = 18;
  let shouldFailWrite = false;
  let lockChain = Promise.resolve();
  const tracker = new EndpointStatsTracker({
    async recordEndpointHit(_method: string, _endpoint: string, userId?: string) {
      if (!userId) return undefined;
      if (shouldFailWrite) throw Object.assign(new Error('DB write failed'), { code: '57P01' });
      // Simulate PostgreSQL per-user advisory lock serializing concurrent counter commits.
      let committed = 0;
      const run = lockChain.then(async () => {
        await new Promise(resolve => setTimeout(resolve, 15));
        userCalls += 1;
        committed = userCalls;
      });
      lockChain = run;
      await run;
      return committed;
    },
  });

  const app = express();
  const portal = express.Router();
  portal.use(tracker.track('/v1'));
  portal.use((req, res, next) => {
    if (req.get('x-user')) {
      res.locals.user = { id: req.get('x-user') };
      res.locals.apiRequests = userCalls;
    }
    next();
  });
  portal.get('/auth/me', (_req, res) => res.json({ id: 'u1' }));
  portal.get('/usage/me', async (_req, res) => {
    await tracker.flushUser('u1');
    res.locals.apiRequests = userCalls;
    res.json(buildUsageQuota(userCalls));
  });
  portal.post('/classify', (_req, res) => res.json({ tier: 'Urgent' }));
  portal.delete('/classifications/:id', (req, res) => {
    if (req.get('x-forbid')) { res.sendStatus(403); return; }
    res.sendStatus(204);
  });
  app.use('/v1', portal);

  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const headers = { 'x-user': 'u1' };

  // Excluded routes and 403 rejections report current count without incrementing.
  const me = await fetch(`${origin}/v1/auth/me`, { headers });
  assert.equal(me.headers.get('x-api-usage-count'), '18');
  assert.equal(me.headers.get('x-api-limit-exceeded'), 'false');

  const forbidden = await fetch(`${origin}/v1/classifications/id-1`, { method: 'DELETE', headers: { ...headers, 'x-forbid': '1' } });
  assert.equal(forbidden.status, 403);
  assert.equal(forbidden.headers.get('x-api-usage-count'), '18');

  // Failed write keeps displayed count unchanged at 18 while preserving service.
  shouldFailWrite = true;
  const failedWriteRes = await fetch(`${origin}/v1/classify`, { method: 'POST', headers });
  assert.equal(failedWriteRes.status, 200);
  assert.equal(failedWriteRes.headers.get('x-api-usage-count'), '18');
  assert.equal(failedWriteRes.headers.get('x-api-limit-exceeded'), 'false');
  shouldFailWrite = false;

  // Two concurrent calls starting at 18 commit sequentially as 19 and 20, triggering the warning at 20.
  const [first, second] = await Promise.all([
    fetch(`${origin}/v1/classify`, { method: 'POST', headers }),
    fetch(`${origin}/v1/classifications/id-1`, { method: 'DELETE', headers }),
  ]);
  assert.deepEqual([first.status, second.status].sort(), [200, 204]);
  const counts = [first.headers.get('x-api-usage-count'), second.headers.get('x-api-usage-count')].sort();
  const exceeded = [first.headers.get('x-api-limit-exceeded'), second.headers.get('x-api-limit-exceeded')].sort();
  assert.deepEqual(counts, ['19', '20']);
  assert.deepEqual(exceeded, ['false', 'true']);

  // Service continues past 20 calls and GET /v1/usage/me does not self-increment.
  const call21 = await fetch(`${origin}/v1/classify`, { method: 'POST', headers });
  assert.equal(call21.status, 200);
  assert.equal(call21.headers.get('x-api-usage-count'), '21');
  assert.equal(call21.headers.get('x-api-limit-exceeded'), 'true');
  const usageAfter = await fetch(`${origin}/v1/usage/me`, { headers });
  assert.equal(usageAfter.headers.get('x-api-usage-count'), '21');
  assert.equal((await usageAfter.json()).requests, 21);
});

test('flushUser completes without waiting for unrelated public or other-account writes', async t => {
  let releasePublic!: () => void;
  let releaseOther!: () => void;
  const publicHeld = new Promise<void>(resolve => { releasePublic = resolve; });
  const otherHeld = new Promise<void>(resolve => { releaseOther = resolve; });
  let publicStarted = false;
  let otherStarted = false;

  const tracker = new EndpointStatsTracker({
    async recordEndpointHit(_method: string, endpoint: string, userId?: string) {
      if (!userId && endpoint === '/v1/priority') {
        publicStarted = true;
        await publicHeld;
        return undefined;
      }
      if (userId === 'other-user') {
        otherStarted = true;
        await otherHeld;
        return 1;
      }
      return 3;
    },
  });

  const app = express();
  app.use(tracker.track());
  app.get('/v1/priority', (_req, res) => res.json({ cards: [] }));
  const portal = express.Router();
  portal.use(tracker.track('/v1'));
  portal.use((req, res, next) => {
    const uid = req.get('x-user');
    if (uid) {
      res.locals.user = { id: uid };
      res.locals.apiRequests = 3;
    }
    next();
  });
  portal.post('/classify', (_req, res) => res.json({ tier: 'Urgent' }));
  portal.get('/usage/me', async (_req, res) => {
    await tracker.flushUser(res.locals.user.id);
    res.json(buildUsageQuota(3));
  });
  app.use('/v1', portal);

  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  t.after(() => { releasePublic(); releaseOther(); server.closeAllConnections(); server.close(); });
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  // Trigger an unrelated public write and another user's write, both held open.
  assert.equal((await fetch(`${origin}/v1/priority`)).status, 200);
  const otherRequest = fetch(`${origin}/v1/classify`, { method: 'POST', headers: { 'x-user': 'other-user' } });
  while (!publicStarted || !otherStarted) await new Promise(resolve => setTimeout(resolve, 10));

  // Caller's quota read must finish promptly without waiting for either unrelated write.
  const quotaRes = await fetch(`${origin}/v1/usage/me`, {
    headers: { 'x-user': 'caller-user' },
    signal: AbortSignal.timeout(1000),
  });
  assert.equal(quotaRes.status, 200);
  assert.equal((await quotaRes.json()).requests, 3);

  releasePublic();
  releaseOther();
  assert.equal((await otherRequest).status, 200);
  await tracker.flush();
});
