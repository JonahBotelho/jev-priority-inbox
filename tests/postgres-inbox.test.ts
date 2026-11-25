// Exercise competing Render workers and a realistic cutover using disposable databases.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { priorityInboxText } from '../src/locales/priorityInbox.js';
import { Database } from '../src/server/infrastructure/Database.js';
import { InboxRepository } from '../src/server/infrastructure/InboxRepository.js';
import { PostgresInbox } from '../src/server/infrastructure/PostgresInbox.js';
import { SqliteInboxImport } from '../src/server/infrastructure/SqliteInboxImport.js';
import { createTestStore } from './postgres-fixture.js';

const mailbox = 'resend/' + priorityInboxText.receivingAddress;
const receivedAt = '2026-11-21T18:00:00.000Z';
const urgent = { Emergency: 0, Urgent: 1, Routine: 0 };

test('routine counts and requested subjects include only reviewed, unhandled mail from this inbox', async t => {
  const store = await createTestStore();
  t.after(() => store.pool.end());
  const later = '2026-11-22T18:00:00.000Z';
  await store.pool.query(`INSERT INTO jev_priority_messages
    (id,mailbox,provider_id,received_at,status,tier,probabilities,subject,preview,handled) VALUES
    ('old',$1,'old',$2,'complete','Routine',$3,'',NULL,false),
    ('new',$1,'new',$4,'complete','Routine',$3,'Monthly digest','Private preview',false),
    ('tie',$1,'tie',$4,'complete','Routine',$3,'Service news',NULL,false),
    ('unreviewed',$1,'unreviewed',$2,'complete','Routine',NULL,'Unchecked',NULL,false),
    ('hidden',$1,'hidden',$2,'complete','Routine',$3,'Handled',NULL,true),
    ('failed',$1,'failed',$2,'failed','Routine',$3,'Failed',NULL,false),
    ('private','other-inbox','private',$2,'complete','Routine',$3,'Other inbox',NULL,false)`,
  [mailbox, receivedAt, { Emergency: 0, Urgent: 0, Routine: 1 }, later]);

  const summary = await store.snapshot(mailbox);
  assert.deepEqual(summary, { cards: [], routineCount: 3, processing: { pending: 0, failed: 1 } });
  assert.deepEqual(await store.snapshot(mailbox, true), { ...summary, routineMessages: [
    { id: 'new', subject: 'Monthly digest', receivedAt: later },
    { id: 'tie', subject: 'Service news', receivedAt: later },
    { id: 'old', subject: null, receivedAt },
  ] });
});

test('two API instances share receipts and cannot complete or fail a superseded claim', async t => {
  const first = await createTestStore();
  const second = await PostgresInbox.open(first.pool.options.connectionString);
  t.after(async () => { await Promise.all([first.pool.end(), second.pool.end()]); });
  await Promise.all([first.accept(mailbox, 'same-id', receivedAt), second.accept(mailbox, 'same-id', receivedAt)]);
  const claims = await Promise.all([first.claim(mailbox), second.claim(mailbox)]);
  assert.equal(claims.filter(Boolean).length, 1);
  const interrupted = claims.find(job => job !== undefined)!;
  assert.equal(await second.claim(mailbox), undefined);
  await first.pool.query("UPDATE jev_priority_messages SET lease_until=now()-interval '1 second' WHERE id=$1", [interrupted.id]);
  const recovered = (await second.claim(mailbox))!;
  assert.equal(recovered.id, interrupted.id);
  assert.notEqual(recovered.claim_token, interrupted.claim_token);
  await first.fail(interrupted, false);
  await first.complete(interrupted, 'Stale result', urgent, 'Urgent', 50);
  assert.deepEqual((await second.snapshot(mailbox)).processing, { pending: 1, failed: 0 });
  await second.complete(recovered, 'Current result', urgent, 'Urgent', 50, 'Short preview');
  const snapshot = await first.snapshot(mailbox);
  assert.deepEqual(snapshot.cards, [{ id: interrupted.id, subject: 'Current result', tier: 'Urgent', preview: 'Short preview', receivedAt }]);
  assert.equal(await first.claim(mailbox), undefined);
});

test('a fresh connection preserves completed decisions and retries a transient failure only once', async t => {
  const initial = await createTestStore();
  const url = initial.pool.options.connectionString;
  await initial.accept(mailbox, 'approved', receivedAt);
  const done = (await initial.claim(mailbox))!;
  await initial.complete(done, 'Kept', urgent, 'Urgent', 50);
  await initial.pool.end();
  const reopened = await PostgresInbox.open(url);
  t.after(() => reopened.pool.end());
  await reopened.accept(mailbox, 'approved', receivedAt);
  assert.equal(await reopened.claim(mailbox), undefined);
  assert.equal((await reopened.snapshot(mailbox)).cards[0].id, done.id);
  await reopened.accept(mailbox, 'unavailable', receivedAt);
  const job = (await reopened.claim(mailbox))!;
  await reopened.fail(job, true);
  assert.equal(await reopened.claim(mailbox), undefined);
  await reopened.pool.query("UPDATE jev_priority_messages SET next_attempt_at=now() WHERE id=$1", [job.id]);
  await reopened.fail((await reopened.claim(mailbox))!, true);
  assert.deepEqual((await reopened.snapshot(mailbox)).processing, { pending: 0, failed: 1 });
});

test('SQLite import preserves public decisions and queued receipts without importing private mail or repeating reviews', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'jev-import-test-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const path = join(directory, 'backup.sqlite');
  const original = new Database(path);
  const legacy = new InboxRepository(original);
  legacy.accept(mailbox, 'old-approved', receivedAt);
  const approved = legacy.claim(mailbox)!;
  legacy.complete(approved, 'Existing decision', urgent, 'Urgent', 50, 'Saved preview');
  legacy.accept(mailbox, 'old-interrupted', receivedAt);
  legacy.claim(mailbox);
  legacy.accept('private-account', 'private-id', receivedAt);
  legacy.accept('public-demo/older-version', 'old-sample', receivedAt);
  original.connection.close();
  const target = await createTestStore();
  t.after(() => target.pool.end());
  const importer = new SqliteInboxImport(target);
  assert.deepEqual(await importer.run(path), { copied: 3, existing: 0 });
  assert.deepEqual(await importer.run(path), { copied: 0, existing: 3 });
  await target.accept(mailbox, 'old-approved', receivedAt);
  assert.deepEqual((await target.snapshot(mailbox)).cards, [
    { id: approved.id, subject: 'Existing decision', preview: 'Saved preview', tier: 'Urgent', receivedAt },
  ]);
  assert.deepEqual((await target.snapshot(mailbox)).processing, { pending: 1, failed: 0 });
  assert.equal((await target.claim(mailbox))?.provider_id, 'old-interrupted');
  assert.equal(await target.hasPending('private-account'), false);
});

test('the deployed inbox requires a PostgreSQL connection string', async () => {
  await assert.rejects(PostgresInbox.open(undefined), /DATABASE_URL/);
  await assert.rejects(PostgresInbox.open('file:mail.sqlite'), /DATABASE_URL/);
});
