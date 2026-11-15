// Production browser checks against an isolated ephemeral server and SQLite file.
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/browser',
  workers: 1,
  use: { baseURL: 'http://127.0.0.1:3101', headless: true },
  webServer: {
    command: 'node dist/server/main.js',
    url: 'http://127.0.0.1:3101',
    // Exercise an old local setting to ensure it cannot restore the classroom login.
    env: { APP_MODE: 'demo', PORT: '3101', SQLITE_PATH: ':memory:', PUBLIC_URL: 'http://127.0.0.1:3101',
      MAIL_ENCRYPTION_KEY: 'ab'.repeat(32) },
  },
});
