// Exercise IMAP UID reconciliation and SMTP envelope/privacy through provider boundary stubs.
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import nodemailer from 'nodemailer';
import type { ImapFlow } from 'imapflow';
import { randomUUID } from 'node:crypto';
import { MailFixture } from './mail-fixture.js';
import { ManualTransport } from '../src/server/mail/ManualTransport.js';

test('manual synchronization paginates, catches new UIDs, removes missing mail and resets validity', async () => {
  const fixture = new MailFixture();
  const transport = new ManualTransport(fixture.store);
  let validity = '1';
  let uids = Array.from({ length: 60 }, (_, index) => index + 1);
  const client = {
    mailboxOpen: async (_folder: string, options: { readOnly: boolean }) => {
      assert.equal(options.readOnly, true); return { uidValidity: BigInt(validity), uidNext: Math.max(...uids) + 1 };
    },
    search: async () => uids,
    fetch: async function* (selected: number[], query: { source: { maxLength: number } }) {
      assert.equal(query.source.maxLength, 16384);
      for (const uid of selected) yield { uid, envelope: { subject: `Message ${uid}` }, internalDate: '2026-11-13T18:00:00Z',
        source: Buffer.from('Content-Type: text/html\r\n\r\n<p>Opening <b>message</b> text.</p>') };
    },
    logout: async () => {}, close: () => {},
  };
  const stub = transport as unknown as { imap: () => Promise<ImapFlow> };
  const patched = mock.method(stub, 'imap', async () => client as unknown as ImapFlow);
  try {
    const account = fixture.store.connect('manual:test', 'test@example.test', 'manual', MailFixture.settings());
    const batch = await transport.sync(account, false);
    assert.equal(batch.messages.length, 50); assert.equal(batch.older, '11');
    assert.equal(batch.messages[0].preview, 'Opening message text.');
    fixture.store.commit(account.id, batch);
    const card = fixture.database.connection.prepare("SELECT id FROM mail_messages WHERE account_id=? AND provider_id='1:60'").get(account.id) as { id: string };
    fixture.store.update(account.id, card.id, 'Urgent', true);
    const older = await transport.sync(fixture.store.account(account.id)!, true);
    assert.equal(older.messages.length, 10);
    fixture.store.commit(account.id, older, true);
    uids = [...uids.filter(uid => uid !== 60), 61];
    fixture.store.commit(account.id, await transport.sync(fixture.store.account(account.id)!, false));
    assert.equal(fixture.store.database.connection.prepare('SELECT COUNT(*) AS count FROM mail_messages WHERE active=1').get()!.count, 60);
    assert.ok(!fixture.store.message(account.id, card.id));
    validity = '2'; uids = [1, 2];
    fixture.store.commit(account.id, await transport.sync(fixture.store.account(account.id)!, false));
    assert.equal(fixture.store.list(account.id, false, 0).cards.length, 2);
    assert.equal(fixture.store.account(account.id)!.older, null);
  } finally { patched.mock.restore(); fixture.database.connection.close(); }
});

test('SMTP keeps Bcc in envelope only and reports partial and uncertain outcomes', async () => {
  const fixture = new MailFixture();
  const transport = new ManualTransport(fixture.store);
  let source = '';
  let envelope: string[] = [];
  const smtp = nodemailer.createTransport({ name: 'test', version: '1', send(mail, callback) {
    envelope = mail.message.getEnvelope().to;
    mail.message.build((error, buffer) => {
      source = buffer.toString(); callback(error, { accepted: ['to@example.test'], rejected: ['hidden@example.test'], envelope: mail.message.getEnvelope(), messageId: 'test-id' });
    });
  } });
  const stub = transport as unknown as { smtp: () => Promise<typeof smtp> };
  const patched = mock.method(stub, 'smtp', async () => smtp);
  try {
    const account = fixture.store.connect('manual:test', 'test@example.test', 'manual', MailFixture.settings());
    const input = { submissionId: randomUUID(), to: 'to@example.test', cc: '', bcc: 'hidden@example.test', subject: 'Subject', text: 'Text' };
    const result = await transport.send(account, input);
    assert.equal(result.status, 'partial');
    assert.ok(envelope.includes('hidden@example.test')); assert.doesNotMatch(source, /^Bcc:/im);
    assert.match(source, /From: test@example.test/);
    const failing = nodemailer.createTransport({ name: 'test', version: '1', send(_mail, callback) { callback(new Error('Socket closed')); } });
    patched.mock.mockImplementation(async () => failing);
    assert.equal((await transport.send(account, input)).status, 'unknown');
  } finally { patched.mock.restore(); fixture.database.connection.close(); }
});
