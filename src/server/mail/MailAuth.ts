// Mailbox authentication and revocable, account-bound browser sessions.
import { Router, type Request, type Response } from 'express';
import { randomBytes, createHash } from 'node:crypto';
import type { Config } from '../config.js';
import { MailStore, type Account } from './MailStore.js';
import type { MailService } from './MailService.js';
import type { ManualSettings } from '../../shared/mail.js';
import { en } from '../../locales/en.js';

export class MailAuth {
  readonly router = Router();
  private readonly states = new Map<string, { expires: number; nonce: string }>();
  private readonly attempts = new Map<string, { count: number; expires: number }>();
  constructor(private readonly store: MailStore, private readonly service: MailService, private readonly config: Config) {
    this.router.get('/connect/google', (request, response) => {
      if (!config.googleClientId || !config.googleClientSecret) { response.status(503).json({ error: en.mail.unavailable }); return; }
      for (const [state, value] of this.states) if (value.expires < Date.now()) this.states.delete(state);
      const state = randomBytes(32).toString('hex');
      const nonce = randomBytes(32).toString('hex');
      this.states.set(state, { expires: Date.now() + 600000, nonce });
      response.cookie('mail_oauth', state, { httpOnly: true, secure: request.secure, sameSite: 'lax', maxAge: 600000, path: '/v1/connect/google' });
      response.redirect(service.google.oauth().generateAuthUrl({ access_type: 'offline', prompt: 'consent', state,
        scope: ['openid', 'email', 'https://www.googleapis.com/auth/gmail.readonly', 'https://www.googleapis.com/auth/gmail.send'], nonce }));
    });
    this.router.get('/connect/google/callback', async (request, response) => {
      const state = String(request.query.state ?? '');
      const saved = this.states.get(state);
      this.states.delete(state);
      if (!saved || saved.expires < Date.now() || this.cookie(request, 'mail_oauth') !== state) {
        response.status(400).json({ error: en.invalid }); return;
      }
      const oauth = service.google.oauth();
      const { tokens } = await oauth.getToken(String(request.query.code ?? ''));
      const identity = (await oauth.verifyIdToken({ idToken: tokens.id_token!, audience: config.googleClientId })).getPayload();
      if (!identity?.sub || !identity.email || !identity.email_verified || identity.nonce !== saved.nonce) throw new Error(en.invalidLogin);
      const scopes = new Set((tokens.scope ?? '').split(' '));
      if (!scopes.has('https://www.googleapis.com/auth/gmail.readonly') || !scopes.has('https://www.googleapis.com/auth/gmail.send')) throw new Error(en.invalidLogin);
      const existing = store.identity(`google:${identity.sub}`);
      const credentials = { ...tokens, refresh_token: tokens.refresh_token ??
        (existing ? store.decrypt<{ refresh_token?: string }>(existing.secret).refresh_token : undefined) };
      if (!credentials.refresh_token) throw new Error(en.invalidLogin);
      const account = store.connect(`google:${identity.sub}`, identity.email, 'google', credentials);
      this.issue(request, response, account);
      void service.refresh(account.id);
      response.redirect('/');
    });
    this.router.post('/connect/manual', async (request, response) => {
      const key = request.ip ?? '';
      let attempt = this.attempts.get(key);
      if (!attempt || attempt.expires < Date.now()) { attempt = { count: 0, expires: Date.now() + 60000 }; this.attempts.set(key, attempt); }
      if (++attempt.count > 10) { response.status(429).json({ error: en.unavailable }); return; }
      const settings = this.validate(request.body);
      await service.verify(settings);
      const identity = `manual:${settings.imap.host.toLowerCase()}:${settings.imap.port}:${settings.imap.user}`;
      const account = store.connect(identity, settings.email, 'manual', settings);
      this.issue(request, response, account);
      void service.refresh(account.id);
      response.sendStatus(204);
    });
    this.router.delete('/session', (request, response) => {
      this.store.database.connection.prepare('DELETE FROM mail_sessions WHERE token=?').run(this.hash(this.cookie(request, 'mail_session')));
      response.clearCookie('mail_session', { path: '/' }); response.sendStatus(204);
    });
  }

  private validate(value: ManualSettings): ManualSettings {
    if (!value || typeof value.email !== 'string' || !/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(value.email)) throw new Error(en.mail.validation);
    for (const server of [value.imap, value.smtp]) {
      if (!server || !Number.isInteger(server.port) || server.port < 1 || server.port > 65535
        || ![server.host, server.user, server.password].every(text => typeof text === 'string' && text.length > 0 && text.length < 1024)
        || !/^[a-zA-Z0-9.-]+$/.test(server.host)) throw new Error(en.mail.validation);
    }
    if (![465, 587].includes(value.smtp.port)) throw new Error(en.mail.validation);
    return value;
  }

  private hash(value: string) { return createHash('sha256').update(value).digest('hex'); }
  private cookie(request: Request, name: string): string {
    return request.headers.cookie?.split(';').map(part => part.trim()).find(part => part.startsWith(`${name}=`))?.slice(name.length + 1) ?? '';
  }
  private issue(request: Request, response: Response, account: Account): void {
    const token = randomBytes(32).toString('hex');
    this.store.database.connection.prepare('DELETE FROM mail_sessions WHERE expires<?').run(Date.now());
    this.store.database.connection.prepare('INSERT INTO mail_sessions VALUES(?,?,?)').run(this.hash(token), account.id, Date.now() + 8 * 3600000);
    response.cookie('mail_session', token, { httpOnly: true, sameSite: 'lax', secure: request.secure, path: '/', maxAge: 8 * 3600000 });
  }
  account(request: Request): Account | undefined {
    const row = this.store.database.connection.prepare('SELECT account_id FROM mail_sessions WHERE token=? AND expires>?')
      .get(this.hash(this.cookie(request, 'mail_session')), Date.now());
    return row ? this.store.account(String(row.account_id)) : undefined;
  }
}
