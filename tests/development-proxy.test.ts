// Sign-in must work through Vite while requests from foreign origins remain rejected.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { createServer, type ProxyOptions } from 'vite';
import viteConfig from '../vite.config.js';
import { Config } from '../src/server/config.js';
import { Database } from '../src/server/infrastructure/Database.js';
import { InboxRepository } from '../src/server/infrastructure/InboxRepository.js';
import { Application } from '../src/server/http/Application.js';
import { DemoMailbox } from '../src/server/adapters/Providers.js';
import { ChangeEvents } from '../src/server/application/ChangeEvents.js';

test('development proxy accepts same-origin sign-in and forwards its session cookie', async () => {
  const config = new Config();
  const database = new Database(':memory:');
  const api = new Application(config, new InboxRepository(database), new DemoMailbox(), new ChangeEvents()).app.listen(0);
  await new Promise<void>(resolve => api.once('listening', resolve));
  const proxy = viteConfig.server!.proxy!['/v1'] as ProxyOptions;
  const vite = await createServer({
    configFile: false,
    server: { host: '127.0.0.1', port: 0, proxy: {
      '/v1': { ...proxy, target: `http://127.0.0.1:${(api.address() as AddressInfo).port}` },
    } },
  });
  try {
    await vite.listen();
    const origin = `http://127.0.0.1:${(vite.httpServer!.address() as AddressInfo).port}`;
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
    await vite.close();
    api.close();
    api.closeAllConnections();
    database.connection.close();
  }
});
