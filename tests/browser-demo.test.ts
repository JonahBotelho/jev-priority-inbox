// Native Jev transport, post-response persistence and per-account receipt replay against PostgreSQL.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { AddressInfo } from 'node:net';
import { demoHistoryEntry, type DemoReceipt } from '../src/shared/portal.js';
import { jevModel, urgencyRubric } from '../src/shared/jev.js';
import { PortalApi } from '../src/server/application/PortalApi.js';
import { PublicPriorityInbox } from '../src/server/application/PublicPriorityInbox.js';
import { createPublicInboxApi } from '../src/server/http/PublicInboxApi.js';
import { createTestStore } from './postgres-fixture.js';

test('the demo returns probabilities before a DB write and records authentic provider outcomes once', async t => {
  const browserFetch = globalThis.fetch;
  const database = await createTestStore();
  t.after(() => database.pool.end());
  const message = { subject: 'Test request', text: 'Test message to classify' };
  const probabilities = { Emergency: 0.2, Urgent: 0.67, Routine: 0.13 };
  let providerCalls = 0;
  let providerStatus = 200;
  t.mock.method(globalThis, 'fetch', async (url: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(url, init);
    providerCalls++;
    assert.equal(request.url, 'https://api.typesafe.ai/v1/systemone');
    assert.equal(request.headers.get('authorization'), 'Bearer direct-provider-fixture');
    assert.equal(request.headers.get('cookie'), null);
    const { state, model, questions } = await request.json();
    assert.equal(state.subject, message.subject);
    assert.equal(state.text, message.text);
    assert.equal(model, jevModel);
    assert.equal(questions.urgency.instructions, urgencyRubric);
    if (providerStatus !== 200) return new Response('private provider diagnostic', { status: providerStatus });
    return Response.json({ model, answers: { urgency: { type: 'choice', probabilities } },
      usage: { input_tokens: 91, output_tokens: 3 } });
  });
  const portal = await PortalApi.open(database, undefined, { TYPESAFE_API_KEY: 'direct-provider-fixture' });
  const inbox = await PublicPriorityInbox.open(database);
  const server = createPublicInboxApi(inbox, portal).listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
  function post(path: string, body: unknown, cookie = '') {
    return browserFetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify(body), signal: AbortSignal.timeout(5000) });
  }
  const read = (path: string, cookie: string) => browserFetch(base + path, { headers: { Cookie: cookie } }).then(res => res.json());
  async function register(email: string) {
    const response = await post('/auth/register', { email, password: 'demo-test' });
    assert.equal(response.status, 201);
    return response.headers.get('set-cookie')!.split(';')[0];
  }
  const member = await register('demo@example.test');
  const other = await register('other@example.test');
  assert.equal((await post('/demo/inference', message)).status, 401);
  assert.equal((await post('/demo/inference', { subject: '  ', text: 'body' }, member)).status, 400);
  assert.equal(providerCalls, 0);

  const blocker = await database.pool.connect();
  let receipt: DemoReceipt;
  try {
    await blocker.query('BEGIN');
    await blocker.query('LOCK TABLE api_usage IN ACCESS EXCLUSIVE MODE');
    const response = await post('/demo/inference', message, member);
    assert.equal(response.status, 200);
    receipt = await response.json();
    assert.deepEqual(receipt.inference.probabilities, probabilities);
    assert.ok(!JSON.stringify(receipt).includes(message.text));
    const timing = response.headers.get('server-timing') ?? '';
    assert.match(timing, /session;dur=\d+/);
    assert.ok(timing.includes(`jev;dur=${receipt.inference.durationMs}`));
    providerStatus = 429;
    const failure = await post('/demo/inference', message, member);
    assert.equal(failure.status, 502);
    assert.ok(!(await failure.text()).includes('private provider diagnostic'));
    providerStatus = 200;
  } finally {
    await blocker.query('ROLLBACK');
    blocker.release();
  }

  assert.equal((await post('/demo/receipts', receipt)).status, 401);
  assert.equal((await post('/demo/receipts', receipt, other)).status, 400);
  const altered = { ...receipt, inference: { ...receipt.inference, durationMs: 9999 } };
  assert.equal((await post('/demo/receipts', altered, member)).status, 400);
  const acknowledgements = await Promise.all([post('/demo/receipts', receipt, member), post('/demo/receipts', receipt, member)]);
  assert.deepEqual(acknowledgements.map(response => response.status), [204, 204]);
  const entry = demoHistoryEntry(receipt.inference);
  assert.deepEqual([entry.tier, entry.score], ['Urgent', 54]);
  assert.deepEqual(await read('/classifications', member), { results: [entry] });
  assert.deepEqual(await read('/classifications', other), { results: [] });
  const { rows } = await database.pool.query('SELECT input_tokens,output_tokens,duration_ms FROM api_usage WHERE id=$1', [entry.id]);
  assert.deepEqual(rows, [{ input_tokens: 91, output_tokens: 3, duration_ms: receipt.inference.durationMs }]);
  assert.equal(providerCalls, 2);

  // A browser that never acknowledges a response still leaves an accurate history and usage record.
  assert.equal((await post('/demo/inference', message, member)).status, 200);
  await t.waitFor(async () => {
    const usage = await read('/usage/me', member);
    assert.deepEqual([usage.requests, usage.successful], [3, 2]);
  });
  assert.equal((await read('/classifications', member)).results.length, 2);
  assert.equal((await read('/usage/me', other)).requests, 0);
  assert.equal(providerCalls, 3);
});
