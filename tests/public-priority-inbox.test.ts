// Public reads use only successful Jev decisions for the demo and leave private mail untouched.
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { test } from 'node:test';
import type { AddressInfo } from 'node:net';
import { Fixtures } from '../src/server/adapters/Fixtures.js';
import type { Classifier } from '../src/server/adapters/Providers.js';
import { PublicPriorityInbox } from '../src/server/application/PublicPriorityInbox.js';
import { createPublicInboxApi } from '../src/server/http/PublicInboxApi.js';
import { Database } from '../src/server/infrastructure/Database.js';
import { InboxRepository } from '../src/server/infrastructure/InboxRepository.js';

test('only reviewed priority emails appear, ranked by the model; repeated reads and restarts reuse results', async t => {
  const database = new Database(':memory:');
  t.after(() => database.connection.close());
  const privateMail = new InboxRepository(database);
  privateMail.accept('other-mailbox', 'private-id', '2026-11-20T16:00:00Z');
  const privateJob = privateMail.claim('other-mailbox')!;
  let calls = 0;
  const classifier: Classifier = { async classify(input) {
    calls++;
    // Deliberately disagree with the fixture's expected labels to exercise the actual model path.
    if (input.text === Fixtures.get('sale').text) return { Emergency: 0.85, Urgent: 0.1, Routine: 0.05 };
    if (input.text === Fixtures.get('signoff').text) return { Emergency: 0.05, Urgent: 0.85, Routine: 0.1 };
    return { Emergency: 0, Urgent: 0, Routine: 1 };
  } };
  const inbox = new PublicPriorityInbox(database, classifier);
  assert.deepEqual(inbox.snapshot().cards, []);
  assert.equal(inbox.snapshot().processing.pending, Fixtures.names.length);
  assert.equal(calls, 0);
  await inbox.reviewPending(new AbortController().signal);
  const snapshot = inbox.snapshot();
  assert.deepEqual(snapshot.cards.map(card => [card.subject, card.tier, card.preview]), [
    [Fixtures.get('sale').subject, 'Emergency', Fixtures.get('sale').text],
    [Fixtures.get('signoff').subject, 'Urgent', Fixtures.get('signoff').text],
  ]);
  assert.deepEqual(snapshot.processing, { pending: 0, failed: 0 });
  assert.equal(database.connection.prepare('SELECT status FROM messages WHERE id=?').get(privateJob.id)?.status, 'processing');
  database.connection.prepare("UPDATE messages SET corrected_tier='Emergency' WHERE provider_id='recovery'").run();
  database.connection.prepare("UPDATE messages SET tier='Emergency', probabilities=NULL WHERE provider_id='digest'").run();
  assert.deepEqual(inbox.snapshot().cards, snapshot.cards);
  const reopened = new PublicPriorityInbox(database, classifier);
  await reopened.reviewPending(new AbortController().signal);
  assert.deepEqual(reopened.snapshot(), snapshot);
  assert.equal(calls, Fixtures.names.length);
});

test('failed inference never supplies a badge and the next startup can review unfinished samples', async t => {
  const database = new Database(':memory:');
  t.after(() => database.connection.close());
  const failed = new PublicPriorityInbox(database, { async classify() { throw new Error('No decision'); } });
  await failed.reviewPending(new AbortController().signal);
  assert.deepEqual(failed.snapshot().cards, []);
  assert.deepEqual(failed.snapshot().processing, { pending: 0, failed: Fixtures.names.length });
  const recovered = new PublicPriorityInbox(database, { async classify() { return { Emergency: 0, Urgent: 1, Routine: 0 }; } });
  await recovered.reviewPending(new AbortController().signal);
  assert.equal(recovered.snapshot().cards.length, Fixtures.names.length);
  assert.deepEqual(recovered.snapshot().processing, { pending: 0, failed: 0 });
});

test('the public endpoint needs no account, credentials or Jev key to read its review status', async t => {
  const database = new Database(':memory:');
  const inbox = new PublicPriorityInbox(database, undefined);
  const privateMail = new InboxRepository(database);
  privateMail.accept('other', 'secret-message', '2026-11-20T09:30:00Z');
  const privateJob = privateMail.claim('other')!;
  privateMail.complete(privateJob.id, 'Private email', { Emergency: 1, Urgent: 0, Routine: 0 }, 'Emergency', 100);
  const server = createPublicInboxApi(inbox).listen(0, '127.0.0.1');
  t.after(async () => {
    await new Promise<void>(resolve => { server.close(() => resolve()); server.closeAllConnections(); });
    database.connection.close();
  });
  await once(server, 'listening');
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
  assert.equal((await fetch(base + '/health')).status, 200);
  const response = await fetch(base + '/priority?mailbox=other', { headers: { Origin: 'https://demo.example.test' } });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('access-control-allow-origin'), '*');
  assert.equal(response.headers.get('set-cookie'), null);
  assert.deepEqual(await response.json(), { cards: [], processing: { pending: Fixtures.names.length, failed: 0 }, reviewAvailable: false });
  for (const path of ['/auth/me', '/admin/dashboard', '/account', '/messages/private']) {
    assert.equal((await fetch(base + path)).status, 404);
  }
  assert.equal((await fetch(base + '/classify', { method: 'POST' })).status, 404);
});
