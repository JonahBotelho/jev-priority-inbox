// Repository-owned migrations isolate new account storage and preserve existing databases.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import { Database } from '../src/server/infrastructure/Database.js';
import { InboxRepository } from '../src/server/infrastructure/InboxRepository.js';
import { MailStore } from '../src/server/mail/MailStore.js';

test('account startup does not create study tables', () => {
  const database = new Database(':memory:');
  try {
    new MailStore(database, 'ab'.repeat(32));
    const tables = database.connection.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(row => row.name);
    assert.ok(tables.includes('mail_accounts'));
    assert.ok(tables.includes('mail_sessions'));
    assert.ok(!tables.includes('messages'));
    assert.ok(!tables.includes('migrations'));
  } finally { database.connection.close(); }
});

test('reopening existing databases preserves account credentials, sessions and study records', () => {
  const path = join(tmpdir(), `jev-migration-${randomUUID()}.sqlite`);
  const key = 'ab'.repeat(32);
  let database = new Database(path);
  try {
    const store = new MailStore(database, key);
    const account = store.connect('manual:existing', 'existing@example.test', 'manual', { password: 'test-credential' });
    store.commit(account.id, { messages: [{ providerId: 'existing', subject: 'Existing mail', preview: 'Opening text.',
      receivedAt: '2026-11-13T18:00:00Z' }], checkpoint: 'saved', older: null });
    const card = store.list(account.id, false, 0).cards[0];
    store.update(account.id, card.id, 'Urgent', true);
    database.connection.prepare('INSERT INTO mail_sessions VALUES(?,?,?)').run('saved-session-hash', account.id, Date.now() + 3600000);
    const study = new InboxRepository(database);
    study.accept('study@example.test', 'outage:existing', '2026-11-13T18:00:00Z');
    const job = study.claim()!;
    study.complete(job.id, 'Existing study mail', null, 'Emergency', 90);
    database.connection.exec('ALTER TABLE messages DROP COLUMN preview');
    database.connection.close();

    database = new Database(path);
    const reopened = new MailStore(database, key);
    assert.equal(reopened.account(account.id)!.secret, account.secret);
    assert.deepEqual(reopened.decrypt(account.secret), { password: 'test-credential' });
    assert.equal(database.connection.prepare('SELECT account_id FROM mail_sessions WHERE token=?').get('saved-session-hash')!.account_id, account.id);
    const restored = reopened.list(account.id, false, 0).cards[0];
    assert.deepEqual({ id: restored.id, tier: restored.tier, handled: restored.handled, preview: restored.preview },
      { id: card.id, tier: 'Urgent', handled: true, preview: 'Opening text.' });
    assert.ok(!database.connection.prepare('PRAGMA table_info(messages)').all().some(column => column.name === 'preview'));
    const reopenedStudy = new InboxRepository(database);
    assert.equal(reopenedStudy.snapshot('study@example.test').cards[0].id, job.id);
    assert.ok(database.connection.prepare('PRAGMA table_info(messages)').all().some(column => column.name === 'preview'));
  } finally {
    database.connection.close();
    for (const suffix of ['', '-wal', '-shm']) rmSync(path + suffix, { force: true });
  }
});
