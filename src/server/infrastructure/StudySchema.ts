// Priority queue schema used by the public demo and offline studies.
import type { Database } from './Database.js';

export class StudySchema {
  static migrate(database: Database): void {
    const connection = database.connection;
    connection.exec('CREATE TABLE IF NOT EXISTS migrations (version INTEGER PRIMARY KEY)');
    if (!connection.prepare('SELECT version FROM migrations WHERE version=1').get()) {
      database.transaction(() => StudySchema.create(database));
    }
    // Preserve upgrades for existing study databases without touching account tables.
    const columns = connection.prepare('PRAGMA table_info(messages)').all();
    if (!columns.some(column => column.name === 'preview')) {
      connection.exec('ALTER TABLE messages ADD COLUMN preview TEXT');
    }
  }

  private static create(database: Database): void {
    database.connection.exec(`
      CREATE TABLE messages (
        id TEXT PRIMARY KEY, mailbox TEXT NOT NULL, provider_id TEXT NOT NULL,
        received_at TEXT NOT NULL, created_at INTEGER NOT NULL,
        subject TEXT, probabilities TEXT, tier TEXT, score REAL,
        corrected_tier TEXT, handled INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0,
        next_attempt_at INTEGER NOT NULL DEFAULT 0,
        UNIQUE(mailbox, provider_id)
      );
      CREATE INDEX inbox_order ON messages(mailbox, status, handled, tier, score);
      INSERT INTO migrations VALUES(1);
    `);
  }
}
