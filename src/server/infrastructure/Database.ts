// Owns the SQLite connection and versioned schema migration.
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export class Database {
  readonly connection: DatabaseSync;

  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.connection = new DatabaseSync(path);
    this.connection.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
    this.migrate();
    const columns = this.connection.prepare('PRAGMA table_info(messages)').all();
    if (!columns.some(column => column.name === 'preview')) {
      this.connection.exec('ALTER TABLE messages ADD COLUMN preview TEXT');
    }
  }

  private migrate(): void {
    this.connection.exec('CREATE TABLE IF NOT EXISTS migrations (version INTEGER PRIMARY KEY)');
    if (this.connection.prepare('SELECT version FROM migrations WHERE version=1').get()) return;
    this.connection.exec(`BEGIN IMMEDIATE;
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
      COMMIT;`);
  }

  transaction<T>(action: () => T): T {
    this.connection.exec('BEGIN IMMEDIATE');
    try {
      const result = action();
      this.connection.exec('COMMIT');
      return result;
    } catch (error) {
      this.connection.exec('ROLLBACK');
      throw error;
    }
  }
}
