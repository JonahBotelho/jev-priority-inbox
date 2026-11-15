// Website configuration cannot select the legacy classroom or study server.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Config } from '../src/server/config.js';

test('site startup ignores legacy modes and requires account encryption', () => {
  const settings = ['APP_MODE', 'MAIL_ENCRYPTION_KEY', 'SESSION_SECRET', 'SQLITE_PATH', 'MAILBOX_PASSWORD'];
  const original = new Map(settings.map(name => [name, process.env[name]]));
  try {
    process.env.SESSION_SECRET = 'test-session-secret-at-least-thirty-two-characters';
    process.env.MAIL_ENCRYPTION_KEY = 'ab'.repeat(32);
    delete process.env.SQLITE_PATH;
    delete process.env.MAILBOX_PASSWORD;
    for (const mode of [undefined, 'demo', 'live', 'connected']) {
      if (mode === undefined) delete process.env.APP_MODE;
      else process.env.APP_MODE = mode;
      const config = new Config();
      assert.equal(config.mode, 'connected');
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
