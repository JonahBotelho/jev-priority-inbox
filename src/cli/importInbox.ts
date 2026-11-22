// Import an existing public SQLite inbox backup into the configured PostgreSQL database.
import 'dotenv/config';
import { en } from '../locales/en.js';
import { PostgresInbox } from '../server/infrastructure/PostgresInbox.js';
import { SqliteInboxImport } from '../server/infrastructure/SqliteInboxImport.js';

async function importInbox(): Promise<void> {
  const path = process.argv[2];
  if (!path) throw new Error(en.importUsage);
  const database = await PostgresInbox.open(process.env.DATABASE_URL);
  try {
    const { copied, existing } = await new SqliteInboxImport(database).run(path);
    console.log(en.importResult(copied, existing));
  } finally { await database.pool.end(); }
}

importInbox().catch((error: Error) => {
  const known = [en.importUsage, en.databaseUrlRequired, en.missingInboxTable];
  console.error(known.includes(error.message) ? error.message : en.importFailed);
  process.exitCode = 1;
});
