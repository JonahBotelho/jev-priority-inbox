// Website configuration cannot select the legacy classroom or study server.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Config } from '../src/server/config.js';

test('site startup ignores legacy modes and requires account encryption', () => {
  const settings = ['APP_MODE', 'MAIL_ENCRYPTION_KEY', 'SESSION_SECRET', 'SQLITE_PATH', 'MAILBOX_PASSWORD',
    'APP_JWT_SECRET', 'INITIAL_ADMIN_EMAIL', 'INITIAL_ADMIN_PASSWORD', 'CLIENT_ORIGIN'];
  const original = new Map(settings.map(name => [name, process.env[name]]));
  try {
    delete process.env.SESSION_SECRET;
    process.env.MAIL_ENCRYPTION_KEY = 'ab'.repeat(32);
    process.env.APP_JWT_SECRET = 'cd'.repeat(32);
    process.env.INITIAL_ADMIN_EMAIL = 'admin@example.test';
    process.env.INITIAL_ADMIN_PASSWORD = 'test-admin-password-123';
    process.env.CLIENT_ORIGIN = 'http://localhost:5173';
    delete process.env.SQLITE_PATH;
    delete process.env.MAILBOX_PASSWORD;
    for (const mode of [undefined, 'demo', 'live', 'connected']) {
      if (mode === undefined) delete process.env.APP_MODE;
      else process.env.APP_MODE = mode;
      const config = new Config();
      assert.equal(config.databasePath, './data/mail.sqlite');
    }
    delete process.env.MAIL_ENCRYPTION_KEY;
    assert.throws(() => new Config());
  } finally {
    for (const [name, value] of original) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});
