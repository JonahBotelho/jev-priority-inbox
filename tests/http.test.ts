// HTTP access and signed webhook acceptance tests with an isolated database.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { Application } from '../src/server/http/Application.js';
import { Config } from '../src/server/config.js';
import { Database } from '../src/server/infrastructure/Database.js';
import { InboxRepository } from '../src/server/infrastructure/InboxRepository.js';
import { ChangeEvents } from '../src/server/application/ChangeEvents.js';
import { DemoMailbox } from '../src/server/adapters/Providers.js';

test('sessions protect reads, streams, ownership, mutations and origin', async () => {
  const config = new Config();
  const database = new Database(':memory:');
  const repository = new InboxRepository(database);
  const server = new Application(config, repository, new DemoMailbox(), new ChangeEvents()).app.listen(0);
  await new Promise<void>(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
  try {
    for (const path of ['/priority', '/events', '/messages/missing']) assert.equal((await fetch(base + path)).status, 401);
    const session = await fetch(base + '/session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: config.password }) });
    const cookie = session.headers.get('set-cookie')!;
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /SameSite=Strict/);
    const headers = { Cookie: cookie.split(';')[0], 'Content-Type': 'application/json' };
    assert.equal((await fetch(base + '/priority', { headers })).status, 200);
    repository.accept('other@example.test', 'outage:1', new Date().toISOString());
    const id = String(database.connection.prepare('SELECT id FROM messages').get()!.id);
    assert.equal((await fetch(base + '/messages/' + id, { headers })).status, 404);
    assert.equal((await fetch(base + '/messages/' + id, { method: 'PATCH', headers, body: '{"handled":true}' })).status, 404);
    assert.equal((await fetch(base + '/session', { method: 'POST', headers: { ...headers, Origin: 'https://foreign.example' }, body: '{}' })).status, 403);
    assert.equal((await fetch(base + '/priority', { headers: { Cookie: headers.Cookie + 'tamper' } })).status, 401);
  } finally { server.close(); server.closeAllConnections(); database.connection.close(); }
});

test('webhooks verify raw signatures, timestamp, recipients and duplicate delivery', async () => {
  const key = Buffer.from('test-signing-secret-for-webhook');
  const config = Object.assign(new Config(), { mode: 'live', webhookSecret: 'whsec_' + key.toString('base64') });
  const database = new Database(':memory:');
  const repository = new InboxRepository(database);
  const server = new Application(config, repository, new DemoMailbox(), new ChangeEvents()).app.listen(0);
  await new Promise<void>(resolve => server.once('listening', resolve));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1/inbound`;
  async function send(recipient: string, timestamp = String(Math.floor(Date.now() / 1000)), valid = true) {
    const body = JSON.stringify({ type: 'email.received', created_at: new Date().toISOString(), data: { email_id: 'outage:1', to: [recipient] } });
    const signature = createHmac('sha256', key).update(`event-1.${timestamp}.${body}`).digest('base64');
    return fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'svix-id': 'event-1',
      'svix-timestamp': timestamp, 'svix-signature': `v1,${valid ? signature : 'invalid'}` }, body });
  }
  try {
    assert.equal((await send(config.mailbox, undefined, false)).status, 400);
    assert.equal((await send(config.mailbox, '1')).status, 400);
    assert.equal((await send('wrong@example.test')).status, 400);
    assert.equal((await send(config.mailbox)).status, 200);
    assert.equal((await send(config.mailbox)).status, 200);
    assert.equal(repository.snapshot(config.mailbox).processing.pending, 1);
  } finally { server.close(); server.closeAllConnections(); database.connection.close(); }
});
