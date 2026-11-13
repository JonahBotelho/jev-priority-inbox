// One Express listener serves the built frontend and same-origin API in development.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import viteConfig from '../vite.config.js';
import { Config } from '../src/server/config.js';
import { Database } from '../src/server/infrastructure/Database.js';
import { InboxRepository } from '../src/server/infrastructure/InboxRepository.js';
import { Application } from '../src/server/http/Application.js';
import { DemoMailbox } from '../src/server/adapters/Providers.js';
import { ChangeEvents } from '../src/server/application/ChangeEvents.js';

test('single development listener serves the frontend and authenticated API', async () => {
  const config = new Config();
  const database = new Database(':memory:');
  const api = new Application(config, new InboxRepository(database), new DemoMailbox(), new ChangeEvents()).app.listen(0);
  await new Promise<void>(resolve => api.once('listening', resolve));
  assert.equal(viteConfig.server!.middlewareMode, true);
  assert.equal(viteConfig.preview!.port, 8000);
  try {
    const origin = `http://127.0.0.1:${(api.address() as AddressInfo).port}`;
    const frontend = await fetch(origin);
    assert.equal(frontend.status, 200);
    assert.match(await frontend.text(), /<div id="root">/);
    const response = await fetch(origin + '/v1/session', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin },
      body: JSON.stringify({ password: config.password }),
    });
    assert.equal(response.status, 204);
    const cookie = response.headers.get('set-cookie')!.split(';')[0];
    assert.equal((await fetch(origin + '/v1/priority', { headers: { Cookie: cookie } })).status, 200);
    const foreign = await fetch(origin + '/v1/session', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://foreign.example' },
      body: JSON.stringify({ password: config.password }),
    });
    assert.equal(foreign.status, 403);
  } finally {
    api.close();
    api.closeAllConnections();
    database.connection.close();
  }
});
