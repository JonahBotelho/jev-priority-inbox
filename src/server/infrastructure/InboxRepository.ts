// SQLite support for the original offline study and older data files.
import { randomUUID } from 'node:crypto';
import type { Card, Probabilities, Snapshot, Tier } from '../../shared/types.js';
import { Database } from './Database.js';
import { MessagePreview } from '../application/MessagePreview.js';
import { StudySchema } from './StudySchema.js';
import type { Job, PriorityQueue } from './PriorityQueue.js';
export type { Job } from './PriorityQueue.js';

export class InboxRepository implements PriorityQueue {
  constructor(readonly database: Database) { StudySchema.migrate(database); }

  accept(mailbox: string, providerId: string, receivedAt: string): boolean {
    const result = this.database.connection.prepare(`INSERT INTO messages(id, mailbox, provider_id, received_at, created_at)
      VALUES(?,?,?,?,?) ON CONFLICT(mailbox, provider_id) DO NOTHING`)
      .run(randomUUID(), mailbox, providerId, receivedAt, Date.now());
    return result.changes === 1;
  }

  recover(mailbox: string | null = null): void {
    // An interrupted attempt can safely repeat because only a committed decision is displayed.
    this.database.connection.prepare(`UPDATE messages SET status='pending' WHERE status='processing'
      AND (? IS NULL OR mailbox=?)`).run(mailbox, mailbox);
  }

  retryFailed(mailbox: string): void {
    this.database.connection.prepare(`UPDATE messages SET status='pending', attempts=0, next_attempt_at=0
      WHERE mailbox=? AND status='failed'`).run(mailbox);
  }

  claim(mailbox: string | null = null): Job | undefined {
    return this.database.transaction(() => {
      const row = this.database.connection.prepare(`SELECT * FROM messages WHERE status='pending'
        AND next_attempt_at <= ? AND (? IS NULL OR mailbox=?) ORDER BY created_at, id LIMIT 1`)
        .get(Date.now(), mailbox, mailbox) as unknown as Job | undefined;
      if (row) this.database.connection.prepare("UPDATE messages SET status='processing', attempts=attempts+1 WHERE id=?").run(row.id);
      return row;
    });
  }

  complete(job: Job | string, subject: string, probabilities: Probabilities | null, tier: Tier, score: number, text?: string): void {
    const id = typeof job === 'string' ? job : job.id;
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

  snapshot(mailbox: string, decisions: 'with-corrections' | 'model-only' = 'with-corrections'): Snapshot {
    const tier = decisions === 'model-only' ? 'tier' : 'COALESCE(corrected_tier,tier)';
    const confirmed = decisions === 'model-only' ? 'AND probabilities IS NOT NULL' : '';
    const cards = this.database.connection.prepare(`SELECT id, ${tier} AS tier, subject, preview,
      received_at AS receivedAt FROM messages WHERE mailbox=? AND status='complete' AND handled=0
      ${confirmed} AND ${tier} IN ('Emergency','Urgent')
      ORDER BY CASE ${tier} WHEN 'Emergency' THEN 0 ELSE 1 END,
      score DESC, received_at DESC, id ASC`).all(mailbox) as unknown as Card[];
    return { cards, processing: this.processing(mailbox) };
  }

  processing(mailbox: string): Snapshot['processing'] {
    const counts = this.database.connection.prepare(`SELECT
      SUM(CASE WHEN status IN ('pending','processing') THEN 1 ELSE 0 END) AS pending,
      SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END) AS failed FROM messages WHERE mailbox=?`).get(mailbox)!;
    return { pending: Number(counts.pending ?? 0), failed: Number(counts.failed ?? 0) };
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

  purge(): void {
    this.database.connection.prepare('DELETE FROM messages WHERE created_at < ?').run(Date.now() - 7 * 86400000);
  }
}
