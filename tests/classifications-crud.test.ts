// PostgreSQL-backed CRUD tests for PUT and DELETE /v1/classifications/:id, ownership isolation, and soft-delete guarantees.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { AddressInfo } from 'node:net';
import { jevModel } from '../src/shared/jev.js';
import type { DemoReceipt, PortalDashboard, PortalHistory, PortalUsage } from '../src/shared/portal.js';
import { PortalApi } from '../src/server/application/PortalApi.js';
import { PublicPriorityInbox } from '../src/server/application/PublicPriorityInbox.js';
import { createPublicInboxApi } from '../src/server/http/PublicInboxApi.js';
import { createTestStore } from './postgres-fixture.js';

const testEnv = {
  APP_JWT_SECRET: '44'.repeat(32),
  INITIAL_ADMIN_EMAIL: 'crud-admin@example.test',
  INITIAL_ADMIN_PASSWORD: 'admin-password-crud',
  PUBLIC_URL: 'http://127.0.0.1:0',
  CLIENT_ORIGIN: 'http://127.0.0.1:5173',
  TYPESAFE_API_KEY: 'crud-test-typesafe-key',
};

test('PUT and DELETE /v1/classifications/:id enforce ownership, validate inputs, soft-delete cleanly, and update dashboard stats', async t => {
  const realFetch = globalThis.fetch;
  t.mock.method(globalThis, 'fetch', async (resource: RequestInfo | URL, init?: RequestInit) => {
    const req = new Request(resource, init);
    if (req.url === 'https://api.typesafe.ai/v1/systemone') {
      return Response.json({
        model: jevModel,
        answers: { urgency: { type: 'choice', probabilities: { Emergency: 0.1, Urgent: 0.8, Routine: 0.1 } } },
        usage: { input_tokens: 40, output_tokens: 4 },
      });
    }
    return realFetch(resource, init);
  });

  const database = await createTestStore();
  t.after(() => database.pool.end());
  const inbox = await PublicPriorityInbox.open(database);
  const portal = await PortalApi.open(database, undefined, testEnv);
  const server = createPublicInboxApi(inbox, portal).listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;

  const call = (path: string, method = 'GET', body?: unknown, cookie = '', extraHeaders: Record<string, string> = {}) =>
    realFetch(base + path, {
      method,
      headers: {
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(cookie ? { Cookie: cookie } : {}),
        ...extraHeaders,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

  // CORS preflight advertises PUT and DELETE.
  const preflight = await call('/classifications/11111111-1111-4111-8111-111111111111', 'OPTIONS', undefined, '', {
    Origin: testEnv.CLIENT_ORIGIN,
    'Access-Control-Request-Method': 'PUT',
  });
  assert.equal(preflight.status, 204);
  const allowedMethods = preflight.headers.get('access-control-allow-methods') ?? '';
  assert.ok(allowedMethods.includes('PUT'));
  assert.ok(allowedMethods.includes('DELETE'));

  // Register two regular users and sign in admin.
  const ownerRes = await call('/auth/register', 'POST', { email: 'owner@example.test', password: 'owner-password' });
  assert.equal(ownerRes.status, 201);
  const ownerCookie = ownerRes.headers.get('set-cookie')!.split(';')[0];

  const otherRes = await call('/auth/register', 'POST', { email: 'intruder@example.test', password: 'other-password' });
  assert.equal(otherRes.status, 201);
  const otherCookie = otherRes.headers.get('set-cookie')!.split(';')[0];

  const adminRes = await call('/auth/login', 'POST', { email: testEnv.INITIAL_ADMIN_EMAIL, password: testEnv.INITIAL_ADMIN_PASSWORD });
  assert.equal(adminRes.status, 200);
  const adminCookie = adminRes.headers.get('set-cookie')!.split(';')[0];

  // Create a classification owned by owner@example.test and confirm receipt durability.
  const inferRes = await call('/demo/inference', 'POST', { subject: 'Deploy check', text: 'Please review before noon.' }, ownerCookie);
  assert.equal(inferRes.status, 200);
  const receipt = await inferRes.json() as DemoReceipt;
  assert.equal((await call('/demo/receipts', 'POST', receipt, ownerCookie)).status, 204);
  const recordId = receipt.inference.id;
  const missingId = '00000000-0000-4000-8000-000000000999';

  // Auth, validation, ownership, and missing-record checks on PUT.
  assert.equal((await call(`/classifications/${recordId}`, 'PUT', { tier: 'Emergency' })).status, 401);
  assert.equal((await call('/classifications/not-a-uuid', 'PUT', { tier: 'Emergency' }, ownerCookie)).status, 400);
  assert.equal((await call(`/classifications/${recordId}`, 'PUT', { tier: 'InvalidTier' }, ownerCookie)).status, 400);
  assert.equal((await call(`/classifications/${missingId}`, 'PUT', { tier: 'Emergency' }, ownerCookie)).status, 404);
  assert.equal((await call(`/classifications/${recordId}`, 'PUT', { tier: 'Emergency' }, otherCookie)).status, 403);

  // Owner updates tier; mass-assignment fields (score, model) are ignored.
  const putRes = await call(`/classifications/${recordId}`, 'PUT', { tier: 'Emergency', score: 999, model: 'tampered' }, ownerCookie);
  assert.equal(putRes.status, 200);
  const updated = await putRes.json() as PortalHistory;
  assert.equal(updated.id, recordId);
  assert.equal(updated.tier, 'Emergency');
  assert.equal(updated.model, jevModel);
  assert.notEqual(updated.score, 999);

  // Updated tier persists on GET /v1/classifications.
  const afterUpdate = await (await call('/classifications', 'GET', undefined, ownerCookie)).json() as { results: PortalHistory[] };
  assert.equal(afterUpdate.results.length, 1);
  assert.equal(afterUpdate.results[0].tier, 'Emergency');

  // Auth, validation, ownership, and missing-record checks on DELETE.
  assert.equal((await call(`/classifications/${recordId}`, 'DELETE')).status, 401);
  assert.equal((await call('/classifications/not-a-uuid', 'DELETE', undefined, ownerCookie)).status, 400);
  assert.equal((await call(`/classifications/${missingId}`, 'DELETE', undefined, ownerCookie)).status, 404);
  assert.equal((await call(`/classifications/${recordId}`, 'DELETE', undefined, otherCookie)).status, 403);

  // Owner soft-deletes the classification.
  assert.equal((await call(`/classifications/${recordId}`, 'DELETE', undefined, ownerCookie)).status, 204);
  const afterDelete = await (await call('/classifications', 'GET', undefined, ownerCookie)).json() as { results: PortalHistory[] };
  assert.deepEqual(afterDelete.results, []);

  // Repeat DELETE and PUT return 404; replaying the signed receipt does not resurrect the soft-deleted row.
  assert.equal((await call(`/classifications/${recordId}`, 'DELETE', undefined, ownerCookie)).status, 404);
  assert.equal((await call(`/classifications/${recordId}`, 'PUT', { tier: 'Routine' }, ownerCookie)).status, 404);
  assert.equal((await call('/demo/receipts', 'POST', receipt, ownerCookie)).status, 204);
  const afterReplay = await (await call('/classifications', 'GET', undefined, ownerCookie)).json() as { results: PortalHistory[] };
  assert.deepEqual(afterReplay.results, []);

  // Usage audit record remains intact: 15 counted functional requests and 1 successful classification.
  const usage = await (await call('/usage/me', 'GET', undefined, ownerCookie)).json() as PortalUsage;
  assert.equal(usage.requests, 15);
  assert.equal(usage.successful, 1);

  // Admin dashboard Table A & Table B record PUT and DELETE /v1/classifications/:id and exclude 401/403.
  const dashboard = await (await call('/admin/dashboard', 'GET', undefined, adminCookie)).json() as PortalDashboard;
  assert.equal(dashboard.endpoints.find(item => item.method === 'PUT' && item.endpoint === '/v1/classifications/:id')?.requests, 5);
  assert.equal(dashboard.endpoints.find(item => item.method === 'DELETE' && item.endpoint === '/v1/classifications/:id')?.requests, 4);
  assert.equal(dashboard.users.find(user => user.email === 'intruder@example.test')?.requests, 0);
});
