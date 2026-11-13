// Transactional intake, job claims, decisions, and mailbox-scoped reads.
import { randomUUID } from 'node:crypto';
import type { Card, Probabilities, Snapshot, Tier } from '../../shared/types.js';
import { Database } from './Database.js';
import { MessagePreview } from '../application/MessagePreview.js';

export interface Job { id: string; mailbox: string; provider_id: string; received_at: string; attempts: number }

export class InboxRepository {
  constructor(readonly database: Database) {}

  accept(mailbox: string, providerId: string, receivedAt: string): void {
    this.database.transaction(() => {
      this.database.connection.prepare(`INSERT INTO messages(id, mailbox, provider_id, received_at, created_at)
        VALUES(?,?,?,?,?) ON CONFLICT(mailbox, provider_id) DO NOTHING`)
        .run(randomUUID(), mailbox, providerId, receivedAt, Date.now());
    });
  }

  recover(): void {
    // An interrupted attempt can safely repeat because only a committed decision is displayed.
    this.database.connection.exec("UPDATE messages SET status='pending' WHERE status='processing'");
  }

  claim(): Job | undefined {
    return this.database.transaction(() => {
      const row = this.database.connection.prepare(`SELECT * FROM messages WHERE status='pending'
        AND next_attempt_at <= ? ORDER BY created_at, id LIMIT 1`).get(Date.now()) as unknown as Job | undefined;
      if (row) this.database.connection.prepare("UPDATE messages SET status='processing', attempts=attempts+1 WHERE id=?").run(row.id);
      return row;
    });
  }

  complete(id: string, subject: string, probabilities: Probabilities | null, tier: Tier, score: number, text?: string): void {
    this.database.transaction(() => {
      this.database.connection.prepare(`UPDATE messages SET subject=?, probabilities=?, tier=?, score=?, preview=?, status='complete' WHERE id=?`)
        .run(subject, probabilities ? JSON.stringify(probabilities) : null, tier, score,
          text === undefined ? null : MessagePreview.from(text), id);
    });
  }

  fail(job: Job, transient: boolean): void {
    const retry = transient && job.attempts < 1;
    this.database.connection.prepare('UPDATE messages SET status=?, next_attempt_at=? WHERE id=?')
      .run(retry ? 'pending' : 'failed', Date.now() + 1000, job.id);
  }

  snapshot(mailbox: string): Snapshot {
    const cards = this.database.connection.prepare(`SELECT id, COALESCE(corrected_tier,tier) AS tier, subject, preview,
      received_at AS receivedAt FROM messages WHERE mailbox=? AND status='complete' AND handled=0
      AND COALESCE(corrected_tier,tier) IN ('Emergency','Urgent')
      ORDER BY CASE COALESCE(corrected_tier,tier) WHEN 'Emergency' THEN 0 ELSE 1 END,
      score DESC, received_at DESC, id ASC`).all(mailbox) as unknown as Card[];
    const counts = this.database.connection.prepare(`SELECT
      SUM(CASE WHEN status IN ('pending','processing') THEN 1 ELSE 0 END) AS pending,
      SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END) AS failed FROM messages WHERE mailbox=?`).get(mailbox)!;
    return { cards, processing: { pending: Number(counts.pending ?? 0), failed: Number(counts.failed ?? 0) } };
  }

  find(mailbox: string, id: string): Job | undefined {
    return this.database.connection.prepare('SELECT * FROM messages WHERE mailbox=? AND id=?').get(mailbox, id) as unknown as Job | undefined;
  }

  update(mailbox: string, id: string, handled: boolean | undefined, correctedTier: Tier | undefined): boolean {
    return this.database.transaction(() => {
      if (!this.find(mailbox, id)) return false;
      if (handled !== undefined) this.database.connection.prepare('UPDATE messages SET handled=? WHERE mailbox=? AND id=?').run(Number(handled), mailbox, id);
      if (correctedTier) this.database.connection.prepare('UPDATE messages SET corrected_tier=? WHERE mailbox=? AND id=?').run(correctedTier, mailbox, id);
      return true;
    });
  }

  savePreview(mailbox: string, id: string, text: string): void {
    this.database.connection.prepare('UPDATE messages SET preview=? WHERE mailbox=? AND id=?')
      .run(MessagePreview.from(text), mailbox, id);
  }

  purge(): void {
    this.database.connection.prepare('DELETE FROM messages WHERE created_at < ?').run(Date.now() - 7 * 86400000);
  }
}
