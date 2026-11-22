// Each database lives inside the test runner's temporary cluster and is isolated from other tests.
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { PostgresInbox } from '../src/server/infrastructure/PostgresInbox.js';

export async function createTestStore(): Promise<PostgresInbox> {
  const url = URL.parse(process.env.JEV_TEST_PG_URL ?? '');
  if (!url || url.hostname !== '127.0.0.1' || url.username !== 'jev_test') throw new Error('Use npm test to start isolated PostgreSQL.');
  const name = 'jev_' + randomUUID().replaceAll('-', '');
  const admin = new Pool({ connectionString: url.href });
  try { await admin.query('CREATE DATABASE ' + name); }
  finally { await admin.end(); }
  url.pathname = '/' + name;
  return PostgresInbox.open(url.href);
}
