// Account-scoped persistence, encrypted credentials, durable synchronization and send receipts.
import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from 'node:crypto';
import { Database } from '../infrastructure/Database.js';
import type { MailCard, MailDetail, SendResult } from '../../shared/mail.js';
import type { Tier } from '../../shared/types.js';
import { MessagePreview } from '../application/MessagePreview.js';

export interface Account { id: string; identity: string; email: string; kind: 'google' | 'manual';
  secret: string; checkpoint: string | null; older: string | null; error: string | null; lastSync: string | null }
export interface Incoming { providerId: string; subject: string; receivedAt: string; preview?: string }
export interface SyncBatch { messages: Incoming[]; checkpoint: string; older: string | null; activeIds?: string[]; reset?: boolean }

export class MailStore {
  constructor(readonly database: Database, private readonly key: string) {
    database.connection.exec(`
      CREATE TABLE IF NOT EXISTS mail_accounts (
        id TEXT PRIMARY KEY, identity TEXT UNIQUE NOT NULL, email TEXT NOT NULL, kind TEXT NOT NULL,
        secret TEXT NOT NULL, checkpoint TEXT, older TEXT, error TEXT, lastSync TEXT);
      CREATE TABLE IF NOT EXISTS mail_messages (
        id TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES mail_accounts(id) ON DELETE CASCADE,
        provider_id TEXT NOT NULL, subject TEXT NOT NULL, received_at TEXT NOT NULL,
        tier TEXT, handled INTEGER NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 1,
        UNIQUE(account_id, provider_id));
      CREATE TABLE IF NOT EXISTS mail_sends (
        account_id TEXT NOT NULL REFERENCES mail_accounts(id) ON DELETE CASCADE,
        submission_id TEXT NOT NULL, result TEXT NOT NULL, PRIMARY KEY(account_id, submission_id));
      CREATE TABLE IF NOT EXISTS mail_sessions (
        token TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES mail_accounts(id) ON DELETE CASCADE,
        expires INTEGER NOT NULL);
    `);
    const columns = database.connection.prepare('PRAGMA table_info(mail_messages)').all();
    if (!columns.some(column => column.name === 'preview')) {
      database.connection.exec('ALTER TABLE mail_messages ADD COLUMN preview TEXT');
    }
    // A crash during provider submission cannot establish whether the provider accepted it.
    database.connection.prepare(`UPDATE mail_sends SET result=? WHERE json_extract(result,'$.status')='sending'`)
      .run(JSON.stringify({ status: 'unknown' }));
  }

  encrypt(value: unknown): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', Buffer.from(this.key, 'hex'), iv);
    const data = Buffer.concat([cipher.update(JSON.stringify(value)), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), data]).toString('base64');
  }

  decrypt<T>(value: string): T {
    const data = Buffer.from(value, 'base64');
    const decipher = createDecipheriv('aes-256-gcm', Buffer.from(this.key, 'hex'), data.subarray(0, 12));
    decipher.setAuthTag(data.subarray(12, 28));
    return JSON.parse(Buffer.concat([decipher.update(data.subarray(28)), decipher.final()]).toString());
  }

  accounts(): Account[] { return this.database.connection.prepare('SELECT * FROM mail_accounts').all() as unknown as Account[]; }
  account(id: string): Account | undefined { return this.accounts().find(account => account.id === id); }
  identity(identity: string): Account | undefined { return this.accounts().find(account => account.identity === identity); }

  connect(identity: string, email: string, kind: Account['kind'], credentials: unknown): Account {
    const id = this.identity(identity)?.id ?? randomUUID();
    this.database.connection.prepare(`INSERT INTO mail_accounts(id,identity,email,kind,secret) VALUES(?,?,?,?,?)
      ON CONFLICT(identity) DO UPDATE SET email=excluded.email,secret=excluded.secret,error=NULL`)
      .run(id, identity, email, kind, this.encrypt(credentials));
    return this.account(id)!;
  }

  commit(accountId: string, batch: SyncBatch, olderOnly = false): void {
    this.database.transaction(() => {
      if (!this.account(accountId)) return;
      for (const message of batch.messages) {
        this.database.connection.prepare(`INSERT INTO mail_messages(id,account_id,provider_id,subject,received_at,preview)
          VALUES(?,?,?,?,?,?) ON CONFLICT(account_id,provider_id) DO UPDATE SET
          subject=excluded.subject,received_at=excluded.received_at,active=1,
          preview=COALESCE(excluded.preview,mail_messages.preview)`)
          .run(randomUUID(), accountId, message.providerId, message.subject, message.receivedAt,
            message.preview === undefined ? null : MessagePreview.from(message.preview));
      }
      if (batch.activeIds) {
        const active = new Set(batch.activeIds);
        const rows = this.database.connection.prepare('SELECT id,provider_id FROM mail_messages WHERE account_id=?').all(accountId);
        for (const row of rows) this.database.connection.prepare('UPDATE mail_messages SET active=? WHERE id=?')
          .run(active.has(String(row.provider_id)) ? 1 : 0, String(row.id));
      }
      this.database.connection.prepare(`UPDATE mail_accounts SET checkpoint=?,older=?,error=NULL,lastSync=? WHERE id=?`)
        .run(olderOnly ? this.account(accountId)!.checkpoint : batch.checkpoint,
          olderOnly || batch.reset || !this.account(accountId)!.checkpoint ? batch.older : this.account(accountId)!.older,
          new Date().toISOString(), accountId);
    });
  }

  list(accountId: string, priority: boolean, offset: number): { cards: MailCard[]; more: boolean } {
    const rows = this.database.connection.prepare(`SELECT id,subject,received_at AS receivedAt,tier,handled,COALESCE(preview,'') AS preview
      FROM mail_messages WHERE account_id=? AND active=1 ${priority ? "AND handled=0 AND tier IN ('Emergency','Urgent')" : ''}
      ORDER BY ${priority ? "CASE tier WHEN 'Emergency' THEN 0 ELSE 1 END," : ''} received_at DESC,id LIMIT 51 OFFSET ?`)
      .all(accountId, offset) as unknown as MailCard[];
    return { cards: rows.slice(0, 50).map(row => ({ ...row, handled: Boolean(row.handled) })), more: rows.length > 50 };
  }

  missingPreviews(accountId: string): string[] {
    return this.database.connection.prepare(`SELECT provider_id FROM mail_messages
      WHERE account_id=? AND active=1 AND preview IS NULL ORDER BY received_at DESC LIMIT 50`)
      .all(accountId).map(row => String(row.provider_id));
  }

  message(accountId: string, id: string): { provider_id: string } | undefined {
    return this.database.connection.prepare('SELECT provider_id FROM mail_messages WHERE account_id=? AND id=? AND active=1')
      .get(accountId, id) as { provider_id: string } | undefined;
  }

  update(accountId: string, id: string, tier?: Tier, handled?: boolean): void {
    this.database.connection.prepare(`UPDATE mail_messages SET tier=COALESCE(?,tier),handled=COALESCE(?,handled)
      WHERE account_id=? AND id=?`).run(tier ?? null, handled === undefined ? null : Number(handled), accountId, id);
  }

  receipt(accountId: string, id: string): SendResult | undefined {
    const row = this.database.connection.prepare('SELECT result FROM mail_sends WHERE account_id=? AND submission_id=?').get(accountId, id);
    return row ? JSON.parse(String(row.result)) : undefined;
  }
  saveReceipt(accountId: string, id: string, result: SendResult): void {
    this.database.connection.prepare(`INSERT INTO mail_sends VALUES(?,?,?) ON CONFLICT(account_id,submission_id)
      DO UPDATE SET result=excluded.result`).run(accountId, id, JSON.stringify(result));
  }
  remove(id: string): void { this.database.connection.prepare('DELETE FROM mail_accounts WHERE id=?').run(id); }
}
