// Signed delivery, recipient isolation and idempotency through the real HTTP and SDK paths.
import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { test, type TestContext } from 'node:test';
import type { ClassificationInput } from '../src/shared/types.js';
import { priorityInboxText as labels } from '../src/locales/priorityInbox.js';
import { ResendMailbox } from '../src/server/adapters/ResendMailbox.js';
import type { Classifier } from '../src/server/adapters/Providers.js';
import { PublicPriorityInbox } from '../src/server/application/PublicPriorityInbox.js';
import { PortalApi } from '../src/server/application/PortalApi.js';
import { createPublicInboxApi } from '../src/server/http/PublicInboxApi.js';
import { createTestStore } from './postgres-fixture.js';

const apiKey = 'test-resend-server-key';
const signingKey = Buffer.from('test-only-webhook-key');
const receiver = new ResendMailbox(apiKey, 'whsec_' + signingKey.toString('base64'));
const receivedAt = '2026-11-21T18:00:00.000Z';

function delivery(id = randomUUID(), envelope = [labels.receivingAddress]) {
  return { type: 'email.received', created_at: receivedAt, data: { email_id: id, created_at: receivedAt,
    to: [labels.receivingAddress], received_for: envelope, subject: 'Metadata only' } };
}

function signedHeaders(payload: string, timestamp = Math.floor(Date.now() / 1000)) {
  const id = 'msg_' + randomUUID();
  const signature = createHmac('sha256', signingKey).update(`${id}.${timestamp}.${payload}`).digest('base64');
  return { 'Content-Type': 'application/json', 'svix-id': id, 'svix-timestamp': String(timestamp), 'svix-signature': 'v1,' + signature };
}

async function openApi(t: TestContext, classifier?: Classifier) {
  const db = await createTestStore();
  const inbox = await PublicPriorityInbox.open(db, classifier, receiver);
  const portal = await PortalApi.open(db, undefined, { PUBLIC_URL: 'http://localhost:8000' });
  const server = createPublicInboxApi(inbox, portal).listen(0, '127.0.0.1');
  await once(server, 'listening');
  const endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1/inbound`;
  const send = globalThis.fetch.bind(globalThis);
  const post = (raw: string, headers: Record<string, string> = signedHeaders(raw)) =>
    send(endpoint, { method: 'POST', headers, body: raw });
  const controller = new AbortController();
  const running = inbox.run(controller.signal);
  t.after(async () => {
    controller.abort();
    await running;
    await new Promise<void>(resolve => { server.close(() => resolve()); server.closeAllConnections(); });
    await db.pool.end();
  });
  return { db, inbox, post };
}

test('only fresh, signed Resend deliveries to the correct SMTP envelope enter the queue', async t => {
  const { inbox, post } = await openApi(t);
  const good = delivery();
  const raw = JSON.stringify(good, null, 2);
  assert.equal((await post(raw, { 'Content-Type': 'application/json' })).status, 401);
  assert.equal((await post(JSON.stringify(good), signedHeaders(raw))).status, 401);
  assert.equal((await post(raw, signedHeaders(raw, Math.floor(Date.now() / 1000) - 600))).status, 401);
  assert.equal((await post(JSON.stringify({ type: 'email.delivered' }))).status, 200);
  assert.equal((await post(JSON.stringify(delivery(randomUUID(), ['other@ionooambea.resend.app'])))).status, 200);
  assert.equal((await post(JSON.stringify({ ...good, data: { ...good.data, email_id: 'invalid' } }))).status, 400);
  assert.equal((await post(JSON.stringify({ ...good, data: { ...good.data, received_for: undefined } }))).status, 400);
  assert.equal((await inbox.snapshot()).processing.pending, 0);
  assert.equal((await post(raw)).status, 200);
  assert.equal((await inbox.snapshot()).processing.pending, 1);
  assert.deepEqual((await inbox.snapshot()).cards, []);
});

test('a sleeping live worker wakes, reads each email once and publishes only Jev-approved cleaned previews', async t => {
  const inputs: ClassificationInput[] = [];
  const { db, inbox, post } = await openApi(t, { async classify(input) {
    inputs.push(input);
    return input.subject === 'Monthly digest' ? { Emergency: 0, Urgent: 0, Routine: 1 } : { Emergency: 0, Urgent: 1, Routine: 0 };
  } });
  const urgent = delivery();
  const routine = delivery();
  const reads: string[] = [];
  t.mock.method(globalThis, 'fetch', async (resource: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(resource, init);
    const url = new URL(request.url);
    assert.equal(url.origin, 'https://api.resend.com');
    assert.equal(request.headers.get('authorization'), 'Bearer ' + apiKey);
    const id = url.pathname.split('/').pop()!;
    assert.equal(url.pathname, '/emails/receiving/' + id);
    assert.equal(url.searchParams.get('html_format'), 'cid');
    reads.push(id);
    const isUrgent = id === urgent.data.email_id;
    return Response.json({
      id, received_for: [labels.receivingAddress], from: 'someone@example.com', created_at: receivedAt,
      subject: isUrgent ? 'Approval\0 needed by 3 PM' : 'Monthly digest',
      text: isUrgent ? null : 'Routine private details', html: isUrgent
        ? '<p>Please approve before 3 PM. reviewer@example.com</p><blockquote>private history</blockquote><img src="https://example.com/image.png">' : null,
    });
  });
  const firstBody = JSON.stringify(urgent);
  const repeated = await Promise.all([post(firstBody), post(firstBody)]);
  assert.deepEqual(repeated.map(r => r.status), [200, 200]);
  assert.equal((await post(JSON.stringify(routine))).status, 200);
  // The worker runs independently of HTTP reads, including arrivals after the initial queue is empty.
  for (let n = 0; n < 100 && (await inbox.snapshot()).processing.pending; n++) await delay(10);
  assert.deepEqual((await inbox.snapshot()).processing, { pending: 0, failed: 0 });
  assert.equal((await inbox.snapshot()).receivingAddress, labels.receivingAddress);
  assert.deepEqual((await inbox.snapshot()).cards.map(c => [c.tier, c.subject, c.preview]), [
    ['Urgent', 'Approval needed by 3 PM', 'Please approve before 3 PM.'],
  ]);
  assert.deepEqual(inputs.map(i => i.text).sort(), ['Please approve before 3 PM.', 'Routine private details'].sort());
  assert.ok(inputs.every(i => i.receivedAt === receivedAt && !('from' in i)));
  assert.equal((await post(firstBody)).status, 200);
  assert.deepEqual(reads.sort(), [urgent.data.email_id, routine.data.email_id].sort());
  const { rows: [stored] } = await db.pool.query('SELECT subject,preview FROM jev_priority_messages WHERE provider_id=$1', [routine.data.email_id]);
  assert.deepEqual([stored?.subject, stored?.preview], ['', null]);
});

test('a queued event survives service reconstruction and a fetched email for another alias stays private', async t => {
  const db = await createTestStore();
  t.after(() => db.pool.end());
  const id = randomUUID();
  const initial = await PublicPriorityInbox.open(db, undefined, receiver);
  await initial.acceptDelivery(id, receivedAt);
  const classify = t.mock.fn(async () => ({ Emergency: 1, Urgent: 0, Routine: 0 }));
  t.mock.method(globalThis, 'fetch', () => Response.json({ id, received_for: ['another@example.test'],
    to: [labels.receivingAddress], subject: 'Private', text: 'Private body' }));
  const recovered = await PublicPriorityInbox.open(db, { classify }, receiver);
  await recovered.reviewPending(new AbortController().signal);
  assert.equal(classify.mock.callCount(), 0);
  assert.deepEqual((await recovered.snapshot()).processing, { pending: 0, failed: 1 });
  assert.deepEqual((await recovered.snapshot()).cards, []);
});

test('a failed database write returns 503 and the next signed delivery is stored once', async t => {
  const { db, inbox, post } = await openApi(t);
  const raw = JSON.stringify(delivery());
  t.mock.method(db, 'accept', async () => { throw new Error('Database unavailable'); }, { times: 1 });
  assert.equal((await post(raw)).status, 503);
  assert.deepEqual((await inbox.snapshot()).processing, { pending: 0, failed: 0 });
  assert.equal((await post(raw)).status, 200);
  assert.equal((await post(raw)).status, 200);
  assert.deepEqual((await inbox.snapshot()).processing, { pending: 1, failed: 0 });
});
