// Run each suite against its own disposable PostgreSQL cluster on loopback.
import { randomBytes } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';

const bin = execFileSync('pg_config', ['--bindir'], { encoding: 'utf8' }).trim();
const directory = mkdtempSync(join(tmpdir(), 'jev-postgres-'));
const data = join(directory, 'data');
const password = randomBytes(20).toString('hex');
const pwfile = join(directory, 'pwfile');
let started = false;
try {
  writeFileSync(pwfile, password, { mode: 0o600 });
  execFileSync(join(bin, 'initdb'), ['-D', data, '-U', 'jev_test', '-A', 'scram-sha-256',
    '--pwfile', pwfile, '--no-locale', '-E', 'UTF8']);
  const listener = createServer().listen(0, '127.0.0.1');
  await once(listener, 'listening');
  const port = listener.address().port;
  await new Promise(resolve => listener.close(resolve));
  execFileSync(join(bin, 'pg_ctl'), ['-D', data, '-l', join(directory, 'postgres.log'), '-w', 'start',
    '-o', `-h 127.0.0.1 -p ${port} -c unix_socket_directories=''`]);
  started = true;
  const url = `postgresql://jev_test:${password}@127.0.0.1:${port}/postgres`;
  const args = process.argv[2] === 'browser'
    ? ['node_modules/@playwright/test/cli.js', 'test']
    : ['--import', 'tsx', '--test', 'tests/*.test.ts'];
  const suite = spawn(process.execPath, [...args, ...process.argv.slice(3)], {
    stdio: 'inherit', env: { ...process.env, JEV_TEST_PG_URL: url, DATABASE_URL: url,
      JEV_FUNCTION_URL: '', JEV_FUNCTION_SECRET: '', TYPESAFE_API_KEY: '', TYPESAFE_BASE_URL: '', RESEND_API_KEY: '', RESEND_WEBHOOK_SECRET: '' },
  });
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => suite.kill(signal));
  const [code] = await once(suite, 'exit');
  process.exitCode = code ?? 1;
} finally {
  if (started) execFileSync(join(bin, 'pg_ctl'), ['-D', data, '-m', 'fast', '-w', 'stop']);
  rmSync(directory, { recursive: true, force: true });
}
