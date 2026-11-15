// Keep-alives must preserve pagination while real changes and session expiry still propagate.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MailFixture } from './mail-fixture.js';

test('event stream distinguishes heartbeats from changes and ends expired sessions', async context => {
  const fixture = new MailFixture();
  const server = fixture.application.app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/v1`;
  const controller = new AbortController();
  try {
    const login = await fetch(base + '/connect/manual', { method: 'POST',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(MailFixture.settings()) });
    const cookie = login.headers.get('set-cookie')!.split(';')[0];
    const account = fixture.store.accounts()[0];
    // Advance only the stream's interval; HTTP transport timeouts continue normally.
    context.mock.timers.enable({ apis: ['setInterval'] });
    const stream = await fetch(base + '/events', { headers: { Cookie: cookie }, signal: controller.signal });
    const reader = stream.body!.getReader();
    const decode = async () => new TextDecoder().decode((await reader.read()).value);
    assert.match(await decode(), /event: change/);

    context.mock.timers.tick(15000);
    const heartbeat = await decode();
    assert.match(heartbeat, /: heartbeat/);
    assert.doesNotMatch(heartbeat, /event: change/);

    fixture.service.events.publish(account.id);
    assert.match(await decode(), /event: change/);
    fixture.store.database.connection.prepare('UPDATE mail_sessions SET expires=0 WHERE account_id=?').run(account.id);
    context.mock.timers.tick(15000);
    assert.equal((await reader.read()).done, true);
  } finally {
    controller.abort(); context.mock.timers.reset();
    server.close(); server.closeAllConnections(); fixture.database.connection.close();
  }
});
