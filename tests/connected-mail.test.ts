// Connected mail regressions with offline provider adapters and account-isolated HTTP sessions.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { MailFixture } from './mail-fixture.js';
import { ManualTransport } from '../src/server/mail/ManualTransport.js';
import { GoogleTransport } from '../src/server/mail/GoogleTransport.js';
import { MailStore, type Account } from '../src/server/mail/MailStore.js';

test('connected inbox and sends work without Jev and isolate identities, receipts and sessions', async () => {
  const fixture = new MailFixture();
  const server = fixture.application.app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const address = server.address() as { port: number };
  const base = `http://127.0.0.1:${address.port}/v1`;
  const request = (path: string, cookie = '', method = 'GET', body?: unknown) => fetch(base + path,
    { method, headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const login = async (email: string) => {
    const response = await request('/connect/manual', '', 'POST', MailFixture.settings(email));
    assert.equal(response.status, 204); return response.headers.get('set-cookie')!.split(';')[0];
  };
  try {
    const demo = await (await request('/demo/inbox')).json();
    assert.equal(demo.cards.length, 9);
    assert.equal((await request('/demo/messages/outage')).status, 200);
    assert.equal((await request('/demo/messages/not-a-fixture')).status, 404);
    assert.equal((await request('/account')).status, 401);
    assert.equal((await request('/inbox?view=all')).status, 401);
    const alice = await login('alice@example.test');
    const bob = await login('bob@example.test');
    await fixture.service.tick();
    const snapshot = await (await request('/inbox?view=all', alice)).json();
    assert.equal(snapshot.cards.length, 2);
    assert.equal(snapshot.cards[0].tier, null);
    const id = snapshot.cards[0].id;
    assert.equal((await (await request('/inbox', alice)).json()).cards.length, 0);
    assert.equal((await request(`/messages/${id}`, bob)).status, 404);
    assert.equal((await request(`/messages/${id}`, bob, 'PATCH', { correctedTier: 'Urgent' })).status, 404);
    await request(`/messages/${id}`, alice, 'PATCH', { correctedTier: 'Urgent' });
    assert.equal((await (await request('/inbox', alice)).json()).cards.length, 1);
    await request(`/messages/${id}`, alice, 'PATCH', { handled: true });
    await fixture.service.tick();
    assert.equal((await (await request('/inbox', alice)).json()).cards.length, 0);
    assert.equal((await (await request('/inbox?view=all', alice)).json()).cards.length, 2);
    const input = { submissionId: randomUUID(), to: 'reply@example.test', cc: '', bcc: 'secret@example.test',
      subject: 'Question', text: 'Reply text', replyToId: id };
    const results = await Promise.all([request('/messages/send', alice, 'POST', input), request('/messages/send', alice, 'POST', input)]);
    assert.equal(fixture.sends, 1);
    assert.equal((await results[0].json()).status, 'sent');
    assert.equal(fixture.submitted!.subject, 'Re: Question');
    assert.equal(fixture.receivedReply!.threadId, 'thread-1');
    fixture.result = { status: 'unknown' };
    const unknown = { ...input, submissionId: randomUUID() };
    await request('/messages/send', alice, 'POST', unknown);
    await request('/messages/send', alice, 'POST', unknown);
    assert.equal(fixture.sends, 2);
    assert.equal((await request('/messages/send', bob, 'POST', { ...input, submissionId: randomUUID() })).status, 400);
    const account = fixture.store.identity('manual:imap.example.test:993:alice@example.test')!;
    assert.ok(!account.secret.includes('private-password'));
    assert.equal(fixture.store.decrypt<{ imap: { password: string } }>(account.secret).imap.password, 'private-password');
    fixture.store.saveReceipt(account.id, 'crashed', { status: 'sending' });
    new MailStore(fixture.database, fixture.config.encryptionKey);
    assert.equal(fixture.store.receipt(account.id, 'crashed')!.status, 'unknown');
    fixture.expired = true; await fixture.service.tick();
    assert.ok((await (await request('/account', alice)).json()).error);
    assert.equal((await request('/account', alice, 'DELETE')).status, 204);
    assert.equal((await request('/account', alice)).status, 401);
    assert.equal((await request('/account', bob)).status, 200);
  } finally { server.close(); server.closeAllConnections(); fixture.database.connection.close(); }
});

test('MIME parser extracts HTML and reply headers, manual destination rejects private IPs', async () => {
  const message = await ManualTransport.parse(Buffer.from('From: Person <person@example.test>\r\nReply-To: reply@example.test\r\nMessage-ID: <one@example.test>\r\nContent-Type: text/html\r\n\r\n<p>Hello <b>world</b></p>'));
  assert.equal(message.text, 'Hello world');
  assert.equal(message.replyTo, 'reply@example.test');
  assert.equal(message.messageId, '<one@example.test>');
  for (const host of ['127.0.0.1', '::1', '169.254.169.254', '10.1.1.1', '::ffff:127.0.0.1']) {
    await assert.rejects(ManualTransport.destination(host));
  }
});

class GoogleFixture extends GoogleTransport {
  raw = '';
  thread = '';
  expired = false;
  protected override async request<T>(_account: Account, path: string, data?: unknown): Promise<T> {
    if (path === 'messages/send') { const body = data as { raw: string; threadId: string }; this.raw = body.raw; this.thread = body.threadId; return {} as T; }
    if (path === 'profile') return { historyId: '10' } as T;
    if (path.startsWith('history?')) {
      if (this.expired && path.includes('startHistoryId=old')) throw Object.assign(new Error(), { status: 404 });
      return { historyId: '11', history: [{ messagesAdded: [{ message: { id: 'new' } }] }] } as T;
    }
    if (path.startsWith('messages/')) return { id: path.split('/')[1].split('?')[0], internalDate: '1794592800000',
      snippet: 'Opening text &amp; more.', payload: { headers: [] } } as T;
    return { messages: [{ id: 'first' }, { id: 'new' }] } as T;
  }
}

test('Gmail catches arrivals, recovers expired history and builds threaded MIME with envelope Bcc', async () => {
  const fixture = new MailFixture();
  try {
    const google = new GoogleFixture(fixture.store, fixture.config);
    const account = fixture.store.connect('google:stable-subject', 'google@example.test', 'google', { refresh_token: 'secret' });
    const first = await google.sync(account, false);
    assert.ok(first.messages.some(message => message.providerId === 'new'));
    assert.equal(first.checkpoint, '11');
    assert.equal(first.messages[0].preview, 'Opening text & more.');
    google.expired = true;
    assert.equal((await google.sync({ ...account, checkpoint: 'old' }, false)).reset, true);
    const reply = { subject: 'Question', text: '', from: '', receivedAt: '', threadId: 'thread', messageId: '<original@example.test>' };
    await google.send(account, { submissionId: randomUUID(), to: 'to@example.test', cc: '', bcc: 'hidden@example.test', subject: 'Re: Question', text: 'Answer' }, reply);
    const raw = Buffer.from(google.raw, 'base64url').toString();
    assert.match(raw, /Bcc: hidden@example.test/);
    assert.match(raw, /In-Reply-To: <original@example.test>/);
    assert.equal(google.thread, 'thread');
  } finally { fixture.database.connection.close(); }
});


test('existing mailbox metadata gains previews without losing selection IDs, corrections or handled state', () => {
  const fixture = new MailFixture();
  try {
    const account = fixture.store.connect('manual:old', 'old@example.test', 'manual', MailFixture.settings());
    const message = { providerId: 'old-message', subject: 'Existing mail', receivedAt: '2026-11-13T18:00:00Z' };
    fixture.store.commit(account.id, { messages: [message], checkpoint: '1', older: null });
    const card = fixture.store.list(account.id, false, 0).cards[0];
    fixture.store.update(account.id, card.id, 'Urgent', true);
    fixture.database.connection.exec('ALTER TABLE mail_messages DROP COLUMN preview');
    const reopened = new MailStore(fixture.database, fixture.config.encryptionKey);
    assert.deepEqual(reopened.missingPreviews(account.id), ['old-message']);
    reopened.commit(account.id, { messages: [{ ...message, preview: '  Opening\n\nmessage  text.  ' }], checkpoint: '2', older: null });
    const updated = reopened.list(account.id, false, 0).cards[0];
    assert.equal(updated.id, card.id);
    assert.equal(updated.preview, 'Opening message text.');
    assert.equal(updated.tier, 'Urgent');
    assert.equal(updated.handled, true);
    assert.deepEqual(reopened.missingPreviews(account.id), []);
  } finally { fixture.database.connection.close(); }
});
