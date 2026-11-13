// HTTP entry point for independent connected accounts and classification-free mail.
import express from 'express';
import { resolve } from 'node:path';
import type { Config } from '../config.js';
import { MailStore } from './MailStore.js';
import { MailService } from './MailService.js';
import { MailAuth } from './MailAuth.js';
import type { ComposeInput, SendResult } from '../../shared/mail.js';
import { en } from '../../locales/en.js';
import { DemoPreview } from '../http/DemoPreview.js';

export class ConnectedApplication {
  readonly app = express();
  constructor(config: Config, private readonly store: MailStore, private readonly service: MailService) {
    const auth = new MailAuth(store, service, config);
    this.app.set('trust proxy', 1);
    this.app.disable('x-powered-by');
    this.app.use((_request, response, next) => {
      response.set({ 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin',
        'Content-Security-Policy': "default-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'" }); next();
    });
    this.app.use(express.json({ limit: '256kb' }));
    this.app.use('/v1', (request, response, next) => {
      if (!['GET', 'HEAD'].includes(request.method) &&
        ((request.get('origin') && request.get('origin') !== new URL(config.publicUrl).origin)
          || request.get('sec-fetch-site') === 'cross-site')) {
        response.status(403).json({ error: en.forbidden }); return;
      }
      next();
    });
    this.app.get('/v1/mode', (_request, response) => response.json({ connected: true, google: Boolean(config.googleClientId && config.googleClientSecret) }));
    this.app.use('/v1', auth.router);
    this.app.use('/v1', new DemoPreview().router);
    this.app.use('/v1', (request, response, next) => {
      const account = auth.account(request);
      if (!account) { response.status(401).json({ error: en.unauthorized }); return; }
      response.locals.account = account; next();
    });
    this.app.get('/v1/account', (_request, response) => {
      const { id, email, error, lastSync, older } = response.locals.account;
      response.json({ id, email, error, lastSync, hasOlder: Boolean(older) });
    });
    this.app.delete('/v1/account', async (_request, response) => {
      const account = response.locals.account;
      await service.exclusive(account.id, async () => {
        // Keep credentials available for retry if Google revocation fails.
        await service.revoke(account); store.remove(account.id); service.events.publish(account.id);
      });
      response.sendStatus(204);
    });
    this.app.post('/v1/sync', async (request, response) => {
      await service.refresh(response.locals.account.id, request.body?.older === true); response.sendStatus(204);
    });
    this.app.get('/v1/inbox', (request, response) => {
      const offset = Number(request.query.offset ?? 0);
      if (!Number.isSafeInteger(offset) || offset < 0) { response.status(400).json({ error: en.invalid }); return; }
      response.json(store.list(response.locals.account.id, request.query.view !== 'all', offset));
    });
    this.app.get('/v1/events', (request, response) => {
      const id = response.locals.account.id;
      response.set({ 'Content-Type': 'text/event-stream', 'X-Accel-Buffering': 'no' }); response.flushHeaders();
      const notify = () => { if (!auth.account(request)) response.end(); else response.write('event: change\ndata: {}\n\n'); };
      const unsubscribe = service.events.subscribe(id, notify);
      const timer = setInterval(notify, 15000); notify();
      response.on('close', () => { clearInterval(timer); unsubscribe(); });
    });
    this.app.get('/v1/messages/:id', async (request, response) => {
      const account = response.locals.account;
      const message = store.message(account.id, String(request.params.id));
      if (!message) { response.status(404).json({ error: en.missing }); return; }
      response.json(await service.read(account, message.provider_id));
    });
    this.app.patch('/v1/messages/:id', (request, response) => {
      const id = String(request.params.id);
      const { correctedTier, handled } = request.body ?? {};
      if (!store.message(response.locals.account.id, id)) { response.status(404).json({ error: en.missing }); return; }
      if ((correctedTier !== undefined && !['Emergency', 'Urgent', 'Routine'].includes(correctedTier))
        || (handled !== undefined && handled !== true) || (handled === undefined && correctedTier === undefined)) {
        response.status(400).json({ error: en.invalid }); return;
      }
      store.update(response.locals.account.id, id, correctedTier, handled);
      service.events.publish(response.locals.account.id); response.sendStatus(204);
    });
    this.app.post('/v1/messages/send', async (request, response) => {
      const input = request.body as ComposeInput;
      if (!this.validSend(input)) { response.status(400).json({ error: en.mail.validation }); return; }
      const id = response.locals.account.id;
      const result = await service.exclusive(id, async () => {
        const account = store.account(id);
        if (!account) throw new Error(en.unauthorized);
        const saved = store.receipt(id, input.submissionId);
        if (saved) return saved;
        let reply;
        if (input.replyToId) {
          const source = store.message(id, input.replyToId);
          if (!source) throw new Error(en.missing);
          reply = await service.read(account, source.provider_id);
          input.subject = /^re:/i.test(reply.subject) ? reply.subject : en.mail.replyPrefix + reply.subject;
        }
        store.saveReceipt(id, input.submissionId, { status: 'sending' });
        let receipt: SendResult;
        try { receipt = await service.send(account, input, reply); }
        catch { receipt = { status: 'unknown' }; }
        store.saveReceipt(id, input.submissionId, receipt);
        return receipt;
      });
      response.json(result);
    });
    this.app.use('/v1', (_request, response) => { response.status(404).json({ error: en.missing }); });
    this.app.use(express.static(resolve('dist/client')));
    this.app.get('/{*path}', (_request, response) => response.sendFile(resolve('dist/client/index.html')));
    this.app.use(((error, _request, response, _next) => {
      const allowed = [en.mail.validation, en.mail.imapFailed, en.mail.smtpFailed, en.invalidLogin, en.missing];
      response.status(400).json({ error: allowed.includes(error.message) ? error.message : en.unavailable });
    }) as express.ErrorRequestHandler);
  }

  private validSend(input: ComposeInput): boolean {
    if (!input || ![input.to, input.cc, input.bcc, input.subject, input.text, input.submissionId].every(value => typeof value === 'string')) return false;
    const recipients = [input.to, input.cc, input.bcc].flatMap(value => value.split(',').map(item => item.trim()).filter(Boolean));
    return recipients.length > 0 && recipients.length <= 100 && recipients.every(value => /^[^\s<>@,]+@[^\s<>@,]+\.[^\s<>@,]+$/.test(value))
      && !/[\r\n]/.test(input.subject) && input.subject.length <= 998 && input.text.length <= 100000
      && /^[a-zA-Z0-9-]{16,100}$/.test(input.submissionId)
      && (input.replyToId === undefined || typeof input.replyToId === 'string');
  }
}
