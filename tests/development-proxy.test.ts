// The active account server serves built assets and enforces session and origin boundaries.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import viteConfig from '../vite.config.js';
import { MailFixture } from './mail-fixture.js';

test('single development listener serves the frontend and account API', async () => {
  const fixture = new MailFixture();
  const server = fixture.application.app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const origin = 'http://127.0.0.1:' + (server.address() as AddressInfo).port;
  Object.defineProperty(fixture.config, 'publicUrl', { value: origin });
  try {
    assert.equal(viteConfig.server!.middlewareMode, true);
    assert.equal(viteConfig.preview!.port, 8000);
    const frontend = await fetch(origin);
    assert.equal(frontend.status, 200);
    assert.match(await frontend.text(), /<div id="root">/);
    for (const path of ['/account', '/inbox', '/events', '/messages/missing']) {
      assert.equal((await fetch(origin + '/v1' + path)).status, 401);
    }
    const login = await fetch(origin + '/v1/connect/manual', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin },
      body: JSON.stringify(MailFixture.settings()),
    });
    assert.equal(login.status, 204);
    const session = login.headers.get('set-cookie')!;
    assert.match(session, /HttpOnly/);
    assert.match(session, /SameSite=Lax/);
    const cookie = session.split(';')[0];
    assert.equal((await fetch(origin + '/v1/account', { headers: { Cookie: cookie } })).status, 200);
    assert.equal((await fetch(origin + '/v1/account', { headers: { Cookie: cookie + 'tamper' } })).status, 401);
    const foreign = await fetch(origin + '/v1/sync', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie, Origin: 'https://foreign.example' }, body: '{}',
    });
    assert.equal(foreign.status, 403);
    assert.equal((await fetch(origin + '/v1/session', { method: 'DELETE', headers: { Cookie: cookie } })).status, 204);
    assert.equal((await fetch(origin + '/v1/account', { headers: { Cookie: cookie } })).status, 401);
  } finally {
    server.close(); server.closeAllConnections(); fixture.database.connection.close();
  }
});
