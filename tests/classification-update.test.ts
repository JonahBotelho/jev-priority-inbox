// Standalone unit tests for classification update validation and PUT/DELETE endpoint tracking.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { readClassificationUpdate } from '../src/shared/portal.js';
import { EndpointStatsTracker } from '../src/server/application/EndpointStatsTracker.js';

test('readClassificationUpdate accepts valid tiers and strips unrelated fields', () => {
  assert.deepEqual(readClassificationUpdate({ tier: 'Emergency' }), { tier: 'Emergency' });
  assert.deepEqual(readClassificationUpdate({ tier: 'Urgent', score: 99, userId: 'other', model: 'spoof' }), { tier: 'Urgent' });
  assert.deepEqual(readClassificationUpdate({ tier: 'Routine' }), { tier: 'Routine' });
  assert.equal(readClassificationUpdate({ tier: 'Critical' }), undefined);
  assert.equal(readClassificationUpdate({ tier: 'emergency' }), undefined);
  assert.equal(readClassificationUpdate({ tier: 123 }), undefined);
  assert.equal(readClassificationUpdate({}), undefined);
  assert.equal(readClassificationUpdate(null), undefined);
  assert.equal(readClassificationUpdate('Urgent'), undefined);
});

test('EndpointStatsTracker includes PUT and DELETE /v1/classifications/:id in catalog and normalizes IDs', async t => {
  const counts = new Map<string, number>();
  const userCounts = new Map<string, number>();
  const tracker = new EndpointStatsTracker({
    async recordEndpointHit(method: string, endpoint: string, userId?: string) {
      const key = `${method} ${endpoint}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
      if (userId) userCounts.set(userId, (userCounts.get(userId) ?? 0) + 1);
    },
  });

  const app = express();
  const portal = express.Router();
  portal.use(tracker.track('/v1'));
  portal.put('/classifications/:id', (req, res) => {
    const uid = req.get('x-user');
    if (!uid) { res.sendStatus(401); return; }
    if (uid === 'other') { res.sendStatus(403); return; }
    res.locals.user = { id: uid };
    res.json({ id: req.params.id, tier: 'Routine' });
  });
  portal.delete('/classifications/:id', (req, res) => {
    const uid = req.get('x-user');
    if (!uid) { res.sendStatus(401); return; }
    if (uid === 'other') { res.sendStatus(403); return; }
    res.locals.user = { id: uid };
    res.sendStatus(204);
  });
  app.use('/v1', portal);

  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  // Before traffic, both endpoints appear in merged catalog with 0 counts.
  const emptyCatalog = tracker.mergeWithCatalog([]);
  assert.equal(emptyCatalog.find(item => item.method === 'PUT' && item.endpoint === '/v1/classifications/:id')?.requests, 0);
  assert.equal(emptyCatalog.find(item => item.method === 'DELETE' && item.endpoint === '/v1/classifications/:id')?.requests, 0);

  // Rejected 401 and 403 calls must not count.
  assert.equal((await fetch(`${origin}/v1/classifications/id-1`, { method: 'PUT' })).status, 401);
  assert.equal((await fetch(`${origin}/v1/classifications/id-1`, { method: 'PUT', headers: { 'x-user': 'other' } })).status, 403);
  assert.equal((await fetch(`${origin}/v1/classifications/id-1`, { method: 'DELETE', headers: { 'x-user': 'other' } })).status, 403);

  // Authorized PUT and DELETE calls normalize under :id.
  assert.equal((await fetch(`${origin}/v1/classifications/11111111-1111-4111-8111-111111111111`, { method: 'PUT', headers: { 'x-user': 'owner' } })).status, 200);
  assert.equal((await fetch(`${origin}/v1/classifications/22222222-2222-4222-8222-222222222222`, { method: 'PUT', headers: { 'x-user': 'owner' } })).status, 200);
  assert.equal((await fetch(`${origin}/v1/classifications/11111111-1111-4111-8111-111111111111`, { method: 'DELETE', headers: { 'x-user': 'owner' } })).status, 204);

  await tracker.flush();
  assert.equal(counts.get('PUT /v1/classifications/:id'), 2);
  assert.equal(counts.get('DELETE /v1/classifications/:id'), 1);
  assert.equal(userCounts.get('owner'), 3);
  assert.equal(userCounts.get('other'), undefined);
});
