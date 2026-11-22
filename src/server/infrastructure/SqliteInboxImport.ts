// One-time, read-only import of public inbox decisions and webhook receipts from a SQLite backup.
import { DatabaseSync } from 'node:sqlite';
import { priorityInboxText } from '../../locales/priorityInbox.js';
import { en } from '../../locales/en.js';
import type { PostgresInbox } from './PostgresInbox.js';

export class SqliteInboxImport {
  constructor(private readonly target: PostgresInbox) {}

  async run(path: string): Promise<{ copied: number; existing: number }> {
    const source = new DatabaseSync(path, { readOnly: true });
    try {
      const columns = source.prepare('PRAGMA table_info(messages)').all();
      if (!columns.length) throw new Error(en.missingInboxTable);
      const preview = columns.some(column => column.name === 'preview') ? 'preview' : 'NULL AS preview';
      const select = source.prepare(`SELECT id,mailbox,provider_id,received_at,created_at,status,attempts,next_attempt_at,
        subject,${preview},probabilities,tier,score,handled FROM messages WHERE mailbox GLOB 'public-demo/*' OR mailbox=?`);
      const rows = select.iterate('resend/' + priorityInboxText.receivingAddress);
      return await this.target.transaction(async client => {
        let copied = 0;
        let existing = 0;
        for (const row of rows) {
          const result = await client.query(`INSERT INTO jev_priority_messages
            (id,mailbox,provider_id,received_at,created_at,status,attempts,next_attempt_at,subject,preview,probabilities,tier,score,handled)
            VALUES ($1,$2,$3,$4,to_timestamp($5::double precision/1000),$6,$7,to_timestamp($8::double precision/1000),$9,$10,$11,$12,$13,$14)
            ON CONFLICT (mailbox,provider_id) DO NOTHING`,
          [row.id, row.mailbox, row.provider_id, row.received_at, row.created_at,
            row.status === 'processing' ? 'pending' : row.status, row.attempts, row.next_attempt_at,
            row.subject, row.preview, row.probabilities, row.tier, row.score, Boolean(row.handled)]);
          if (result.rowCount) copied++;
          else existing++;
        }
        return { copied, existing };
      });
    } finally { source.close(); }
  }
}
