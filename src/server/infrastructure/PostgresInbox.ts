// Durable public inbox shared by Render instances. All queries use the pooled PostgreSQL connection.
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { Pool, type PoolClient } from 'pg';
import { en } from '../../locales/en.js';
import type { Card, Probabilities, RoutineEmail, Tier } from '../../shared/types.js';
import { MessagePreview } from '../application/MessagePreview.js';
import type { Job, PriorityQueue } from './PriorityQueue.js';

interface InboxRow {
  cards: Card[];
  routineCount: number;
  routineMessages: RoutineEmail[];
  pending: number;
  failed: number;
}

function withUtcArrival<T extends { receivedAt: string }>(email: T): T {
  return { ...email, receivedAt: new Date(email.receivedAt).toISOString() };
}

const missingRoutineSubject = `status='complete' AND NOT handled AND tier='Routine'
  AND probabilities IS NOT NULL AND NULLIF(subject,'') IS NULL`;

export class PostgresInbox implements PriorityQueue {
  private constructor(readonly pool: Pool) {}

  static async open(connectionString: string | undefined): Promise<PostgresInbox> {
    const url = URL.parse(connectionString?.trim() ?? '');
    if (!url || !['postgresql:', 'postgres:'].includes(url.protocol)) throw new Error(en.databaseUrlRequired);
    const pool = new Pool({ connectionString: url.href, max: 4, connectionTimeoutMillis: 12000,
      idleTimeoutMillis: 15000, enableChannelBinding: true, application_name: 'jev-priority-inbox' });
    pool.on('error', () => console.error(en.databaseUnavailable));
    const inbox = new PostgresInbox(pool);
    try {
      const schema = await readFile(new URL('../../../db/priority-inbox.sql', import.meta.url), 'utf8');
      await inbox.transaction(client => client.query(schema));
      return inbox;
    } catch (error) {
      await pool.end();
      throw error;
    }
  }

  async transaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    let discard = false;
    try {
      await client.query('BEGIN');
      const result = await work(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      try { await client.query('ROLLBACK'); }
      catch { discard = true; }
      throw error;
    } finally { client.release(discard); }
  }

  async accept(mailbox: string, providerId: string, receivedAt: string): Promise<void> {
    await this.pool.query(`INSERT INTO jev_priority_messages (id, mailbox, provider_id, received_at)
      VALUES ($1,$2,$3,$4) ON CONFLICT (mailbox,provider_id) DO NOTHING`, [randomUUID(), mailbox, providerId, receivedAt]);
  }

  async retryFailed(mailbox: string): Promise<void> {
    await this.pool.query(`UPDATE jev_priority_messages SET status='pending', attempts=0, next_attempt_at='-infinity'
      WHERE mailbox=$1 AND status='failed'`, [mailbox]);
  }

  async claim(mailbox?: string): Promise<Job | undefined> {
    // The lease outlasts both provider deadlines. An interrupted job becomes claimable by another worker.
    const result = await this.pool.query<Omit<Job, 'received_at'> & { received_at: Date }>(`WITH next_job AS (
        SELECT id FROM jev_priority_messages WHERE mailbox=$1 AND
          ((status='pending' AND next_attempt_at <= now()) OR (status='processing' AND lease_until <= now()))
        ORDER BY created_at,id LIMIT 1 FOR UPDATE SKIP LOCKED
      )
      UPDATE jev_priority_messages AS m SET status='processing', attempts=attempts+1,
        claim_token=$2, lease_until=now() + interval '1 minute'
      FROM next_job WHERE m.id=next_job.id
      RETURNING m.id,m.mailbox,m.provider_id,m.received_at,m.attempts-1 AS attempts,m.claim_token`,
      [mailbox, randomUUID()]);
    const row = result.rows[0];
    return row && { ...row, received_at: row.received_at.toISOString() };
  }

  async complete(job: Job, subject: string, probabilities: Probabilities | null, tier: Tier, score: number, text?: string): Promise<void> {
    await this.pool.query(`UPDATE jev_priority_messages SET subject=$3, probabilities=$4, tier=$5, score=$6,
      preview=$7, status='complete', claim_token=NULL, lease_until=NULL WHERE id=$1 AND claim_token=$2`,
      [job.id, job.claim_token, subject, probabilities, tier, score, text === undefined ? null : MessagePreview.from(text)]);
  }

  async fail(job: Job, transient: boolean): Promise<void> {
    const status = transient && job.attempts < 1 ? 'pending' : 'failed';
    await this.pool.query(`UPDATE jev_priority_messages SET status=$3, next_attempt_at=now() + interval '1 second',
      claim_token=NULL, lease_until=NULL WHERE id=$1 AND claim_token=$2`, [job.id, job.claim_token, status]);
  }

  async hasPending(mailbox: string): Promise<boolean> {
    const { rows } = await this.pool.query<{ pending: boolean }>(`SELECT EXISTS (SELECT 1 FROM jev_priority_messages
      WHERE mailbox=$1 AND status IN ('pending','processing')) AS pending`, [mailbox]);
    return rows[0].pending;
  }

  async *missingRoutineSubjectIds(mailbox: string): AsyncGenerator<string> {
    let after = '';
    while (true) {
      const { rows } = await this.pool.query<{ provider_id: string }>(`SELECT provider_id FROM jev_priority_messages
        WHERE mailbox=$1 AND provider_id > $2 AND ${missingRoutineSubject} ORDER BY provider_id LIMIT 50`, [mailbox, after]);
      if (!rows.length) return;
      for (const row of rows) yield row.provider_id;
      after = rows[rows.length - 1].provider_id;
    }
  }

  async restoreRoutineSubject(mailbox: string, providerId: string, subject: string): Promise<void> {
    // The row may have been restored or handled while Resend was answering.
    await this.pool.query(`UPDATE jev_priority_messages SET subject=$3
      WHERE mailbox=$1 AND provider_id=$2 AND ${missingRoutineSubject}`, [mailbox, providerId, subject]);
  }

  async snapshot(mailbox: string, includeRoutine = false) {
    // Read both groups and their counts from the same set of committed decisions.
    const { rows } = await this.pool.query<InboxRow>(`WITH inbox AS (
      SELECT id, status, tier, score, received_at, subject, preview,
        (status='complete' AND NOT handled AND probabilities IS NOT NULL) AS reviewed
      FROM jev_priority_messages WHERE mailbox=$1
    ) SELECT
      COALESCE(json_agg(json_build_object('id',id,'tier',tier,'subject',subject,'preview',preview,'receivedAt',received_at)
        ORDER BY (tier='Emergency') DESC,score DESC,received_at DESC,id)
        FILTER (WHERE reviewed AND tier IN ('Emergency','Urgent')), '[]') AS cards,
      count(*) FILTER (WHERE reviewed AND tier='Routine')::integer AS "routineCount",
      COALESCE(json_agg(json_build_object('id',id,'subject',NULLIF(subject,''),'receivedAt',received_at)
        ORDER BY received_at DESC,id) FILTER (WHERE $2::boolean AND reviewed AND tier='Routine'), '[]') AS "routineMessages",
      count(*) FILTER (WHERE status IN ('pending','processing'))::integer AS pending,
      count(*) FILTER (WHERE status='failed')::integer AS failed FROM inbox`, [mailbox, includeRoutine]);
    const { cards, routineCount, routineMessages, pending, failed } = rows[0];
    return { cards: cards.map(withUtcArrival), routineCount, processing: { pending, failed },
      ...(includeRoutine && { routineMessages: routineMessages.map(withUtcArrival) }) };
  }
}
