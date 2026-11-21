// Transport and failure cases at the private Netlify boundary. All gateway calls are simulated.
import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import classify from '../netlify/functions/jev-classify.js';
import { JevClassifier } from '../src/server/adapters/Providers.js';
import { jevModel } from '../src/shared/jev.js';

const endpoint = 'https://classify.example.test/.netlify/functions/jev-classify';
const secret = 'only-for-tests';
const message = { subject: 'Approve the slides', text: 'Approval is due at noon.', receivedAt: '2026-11-20T17:00:00Z' };

const originalEnv = process.env;
beforeEach(() => {
  process.env = { ...originalEnv, JEV_FUNCTION_SECRET: secret, TYPESAFE_API_KEY: 'test-gateway-token',
    TYPESAFE_BASE_URL: 'https://gateway.example.test/typesafe' };
});
afterEach(() => { process.env = originalEnv; });

function post(body: string, token = secret): Request {
  return new Request(endpoint, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body });
}

test('missing configuration, unauthorized calls, and invalid requests make no inference', async t => {
  const outbound = t.mock.method(globalThis, 'fetch', () => { throw new Error('Unexpected inference'); });
  const body = JSON.stringify(message);
  delete process.env.JEV_FUNCTION_SECRET;
  assert.equal((await classify(post(body))).status, 503);
  process.env.JEV_FUNCTION_SECRET = secret;
  assert.equal((await classify(new Request(endpoint))).status, 405);
  assert.equal((await classify(new Request(endpoint, { method: 'POST', body }))).status, 401);
  assert.equal((await classify(post(body, 'wrong-token'))).status, 401);
  assert.equal((await classify(post('{'))).status, 400);
  assert.equal((await classify(post(JSON.stringify({ ...message, text: 'x'.repeat(10001) })))).status, 400);
  assert.equal((await classify(post(JSON.stringify({ ...message, receivedAt: 'invalid' })))).status, 400);
  delete process.env.TYPESAFE_BASE_URL;
  assert.equal((await classify(post(body))).status, 503);
  process.env.TYPESAFE_BASE_URL = 'https://gateway.example.test/typesafe';
  delete process.env.TYPESAFE_API_KEY;
  assert.equal((await classify(post(body))).status, 503);
  assert.equal(outbound.mock.callCount(), 0);
});

test('the function rejects incomplete scores and responses from a different model', async t => {
  let model = jevModel;
  let probabilities: unknown = { Emergency: 0.9, Routine: 0.1 };
  t.mock.method(globalThis, 'fetch', () => Response.json({ model, answers: { urgency: { probabilities } } }));
  assert.equal((await classify(post(JSON.stringify(message)))).status, 502);
  probabilities = { Emergency: 0, Urgent: 1, Routine: 0 };
  model = 'unexpected-model';
  assert.equal((await classify(post(JSON.stringify(message)))).status, 502);
});

test('Render requires a configured function and uses HTTPS for remote endpoints', () => {
  assert.equal(JevClassifier.fromEnvironment({ JEV_FUNCTION_URL: endpoint }), undefined);
  assert.equal(JevClassifier.fromEnvironment({ JEV_FUNCTION_SECRET: secret }), undefined);
  assert.equal(JevClassifier.fromEnvironment({ JEV_FUNCTION_URL: 'http://example.test', JEV_FUNCTION_SECRET: secret }), undefined);
  assert.ok(JevClassifier.fromEnvironment({ JEV_FUNCTION_URL: 'http://127.0.0.1:8888', JEV_FUNCTION_SECRET: secret }));
});
