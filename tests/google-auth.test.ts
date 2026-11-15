// Verify browser-bound OAuth state, scopes and stable Google account identities without external calls.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MailFixture } from './mail-fixture.js';

test('Google callback requires browser state and uses verified subject rather than matching email', async () => {
  const fixture = new MailFixture();
  Object.defineProperty(fixture.config, 'googleClientId', { value: 'pilot-client' });
  Object.defineProperty(fixture.config, 'googleClientSecret', { value: 'pilot-secret' });
  const client = fixture.service.google.oauth();
  let nonce = '';
  let subject = 'first-google-user';
  Object.defineProperty(client, 'getToken', { value: async () => ({ tokens: {
    id_token: 'test-id-token', refresh_token: 'test-refresh-token',
    scope: 'openid email https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.send',
  } }) });
  Object.defineProperty(client, 'verifyIdToken', { value: async () => ({ getPayload: () => ({
    sub: subject, email: 'same@example.test', email_verified: true, nonce,
  }) }) });
  fixture.service.google.oauth = () => client;
  const server = fixture.application.app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  async function start() {
    const response = await fetch(base + '/v1/connect/google', { redirect: 'manual' });
    const authorization = new URL(response.headers.get('location')!);
    nonce = authorization.searchParams.get('nonce')!;
    const state = authorization.searchParams.get('state')!;
    const cookie = response.headers.get('set-cookie')!.split(';')[0];
    return { state, cookie };
  }
  async function connect() {
    const { state, cookie } = await start();
    const callback = await fetch(`${base}/v1/connect/google/callback?state=${state}&code=test-code`,
      { redirect: 'manual', headers: { Cookie: cookie } });
    assert.equal(callback.status, 302);
    const session = callback.headers.get('set-cookie')!.split(';')[0];
    return (await fetch(base + '/v1/account', { headers: { Cookie: session } })).json();
  }
  try {
    const stolen = await start();
    assert.equal((await fetch(`${base}/v1/connect/google/callback?state=${stolen.state}&code=stolen`, { redirect: 'manual' })).status, 400);
    const first = await connect();
    assert.equal((await connect()).id, first.id);
    subject = 'second-google-user';
    assert.notEqual((await connect()).id, first.id);
    assert.equal(fixture.store.accounts().length, 2);
  } finally { server.close(); server.closeAllConnections(); fixture.database.connection.close(); }
});
