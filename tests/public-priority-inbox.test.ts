// Public reads use only successful Jev decisions for the demo and leave private mail untouched.
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { test } from 'node:test';
import type { AddressInfo } from 'node:net';
import { Fixtures } from '../src/server/adapters/Fixtures.js';
import type { Classifier } from '../src/server/adapters/Providers.js';
import { PublicPriorityInbox } from '../src/server/application/PublicPriorityInbox.js';
import { PortalApi } from '../src/server/application/PortalApi.js';
import { createPublicInboxApi } from '../src/server/http/PublicInboxApi.js';
import { createTestStore } from './postgres-fixture.js';

test('only reviewed priority emails appear, ranked by the model; repeated reads and restarts reuse results', async t => {
  const database = await createTestStore();
  t.after(() => database.pool.end());
  await database.accept('other-mailbox', 'private-id', '2026-11-20T16:00:00Z');
  const privateJob = (await database.claim('other-mailbox'))!;
  let calls = 0;
  const classifier: Classifier = { async classify(input) {
    calls++;
    // Deliberately disagree with the fixture's expected labels to exercise the actual model path.
    if (input.text === Fixtures.get('sale').text) return { Emergency: 0.85, Urgent: 0.1, Routine: 0.05 };
    if (input.text === Fixtures.get('signoff').text) return { Emergency: 0.05, Urgent: 0.85, Routine: 0.1 };
    return { Emergency: 0, Urgent: 0, Routine: 1 };
  } };
  const inbox = await PublicPriorityInbox.open(database, classifier);
  assert.deepEqual((await inbox.snapshot()).cards, []);
  assert.equal((await inbox.snapshot()).processing.pending, Fixtures.names.length);
  assert.equal(calls, 0);
  await inbox.reviewPending(new AbortController().signal);
  const snapshot = await inbox.snapshot();
  assert.deepEqual(snapshot.cards.map(card => [card.subject, card.tier, card.preview]), [
    [Fixtures.get('sale').subject, 'Emergency', Fixtures.get('sale').text],
    [Fixtures.get('signoff').subject, 'Urgent', Fixtures.get('signoff').text],
  ]);
  assert.deepEqual(snapshot.processing, { pending: 0, failed: 0 });
  assert.equal(snapshot.routineCount, Fixtures.names.length - 2);
  assert.deepEqual((await inbox.snapshot(true)).routineMessages?.map(email => email.subject),
    Fixtures.names.filter(name => name !== 'sale' && name !== 'signoff').map(name => Fixtures.get(name).subject));
  assert.equal((await database.pool.query('SELECT status FROM jev_priority_messages WHERE id=$1', [privateJob.id])).rows[0].status, 'processing');
  await database.pool.query("UPDATE jev_priority_messages SET tier='Emergency', probabilities=NULL WHERE provider_id='digest'");
  assert.deepEqual((await inbox.snapshot()).cards, snapshot.cards);
  const reopened = await PublicPriorityInbox.open(database, classifier);
  await reopened.reviewPending(new AbortController().signal);
  assert.deepEqual(await reopened.snapshot(), { ...snapshot, routineCount: snapshot.routineCount - 1 });
  assert.equal(calls, Fixtures.names.length);
});

test('failed inference never supplies a badge and the next startup can review unfinished samples', async t => {
  const database = await createTestStore();
  t.after(() => database.pool.end());
  const failed = await PublicPriorityInbox.open(database, { async classify() { throw new Error('No decision'); } });
  await failed.reviewPending(new AbortController().signal);
  assert.deepEqual((await failed.snapshot()).cards, []);
  assert.deepEqual((await failed.snapshot()).processing, { pending: 0, failed: Fixtures.names.length });
  const recovered = await PublicPriorityInbox.open(database, { async classify() { return { Emergency: 0, Urgent: 1, Routine: 0 }; } });
  await recovered.reviewPending(new AbortController().signal);
  assert.equal((await recovered.snapshot()).cards.length, Fixtures.names.length);
  assert.deepEqual((await recovered.snapshot()).processing, { pending: 0, failed: 0 });
});

test('the public endpoint needs no account, credentials or Jev key to read its review status', async t => {
  const database = await createTestStore();
  const inbox = await PublicPriorityInbox.open(database, undefined);
  await database.accept('other', 'secret-message', '2026-11-20T09:30:00Z');
  const privateJob = (await database.claim('other'))!;
  await database.complete(privateJob, 'Private email', { Emergency: 1, Urgent: 0, Routine: 0 }, 'Emergency', 100);
  const portal = await PortalApi.open(database, undefined, { PUBLIC_URL: 'http://localhost:8000' });
  const server = createPublicInboxApi(inbox, portal).listen(0, '127.0.0.1');
  t.after(async () => {
    await new Promise<void>(resolve => { server.close(() => resolve()); server.closeAllConnections(); });
    await database.pool.end();
  });
  await once(server, 'listening');
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
  const health = await fetch(base + '/health');
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), { status: 'ok', storage: 'postgresql' });
  const response = await fetch(base + '/priority?mailbox=other', { headers: { Origin: 'https://demo.example.test' } });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('access-control-allow-origin'), '*');
  assert.equal(response.headers.get('set-cookie'), null);
  const summary = { cards: [], routineCount: 0, processing: { pending: Fixtures.names.length, failed: 0 }, reviewAvailable: false };
  assert.deepEqual(await response.json(), summary);
  const details = await fetch(base + '/priority?include=routine&mailbox=other');
  assert.deepEqual(await details.json(), { ...summary, routineMessages: [] });
  for (const path of ['/auth/me', '/admin/dashboard', '/usage/me', '/classifications']) {
    assert.equal((await fetch(base + path)).status, 401);
  }
  for (const path of ['/account', '/messages/private']) {
    assert.equal((await fetch(base + path)).status, 404);
  }
  assert.equal((await fetch(base + '/classify', { method: 'POST' })).status, 401);
  assert.equal((await fetch(base + '/inbound', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status, 503);
});
