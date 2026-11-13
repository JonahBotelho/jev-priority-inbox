// Express composition, raw webhook intake, origin protection, and static client delivery.
import express from 'express';
import type { ErrorRequestHandler } from 'express';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Config } from '../config.js';
import { WebhookVerifier } from '../adapters/Providers.js';
import type { MailboxProvider } from '../adapters/Providers.js';
import { Fixtures } from '../adapters/Fixtures.js';
import { InboxRepository } from '../infrastructure/InboxRepository.js';
import { ChangeEvents } from '../application/ChangeEvents.js';
import { InboxController } from './InboxController.js';
import { Sessions } from './Sessions.js';
import { en } from '../../locales/en.js';

export class Application {
  readonly app = express();
  private readonly sessions: Sessions;
  private loginAttempts = { count: 0, resetAt: Date.now() + 60000 };

  constructor(private readonly config: Config, private readonly repository: InboxRepository,
    provider: MailboxProvider, private readonly events: ChangeEvents) {
    this.sessions = new Sessions(config);
    this.app.set('trust proxy', 1);
    this.app.disable('x-powered-by');
    this.app.use((_request, response, next) => {
      response.set({ 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin',
        'Content-Security-Policy': "default-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'" });
      next();
    });
    this.app.post('/v1/inbound', express.raw({ type: 'application/json', limit: '256kb' }), (request, response) => {
      if (config.mode !== 'live') { response.status(503).json({ error: en.unavailable }); return; }
      try {
        const event = new WebhookVerifier().verify(request.body.toString(), {
          id: request.get('svix-id') ?? '', timestamp: request.get('svix-timestamp') ?? '', signature: request.get('svix-signature') ?? '',
        }, config.webhookSecret);
        if (event.type !== 'email.received') { response.sendStatus(200); return; }
        if (!event.data.to.some(address => address.toLowerCase() === config.mailbox.toLowerCase())) {
          response.status(400).json({ error: en.invalid }); return;
        }
        if (!event.data.email_id || !Number.isFinite(Date.parse(event.created_at))) throw new Error('Invalid metadata');
        repository.accept(config.mailbox, event.data.email_id, new Date(event.created_at).toISOString());
        events.publish(config.mailbox);
        response.sendStatus(200);
      } catch { response.status(400).json({ error: en.invalid }); }
    });
    this.app.use(express.json({ limit: '16kb' }));
    this.app.use('/v1', (request, response, next) => {
      const origin = request.get('origin');
      if (!['GET', 'HEAD'].includes(request.method) && origin && origin !== `${request.protocol}://${request.get('host')}`) {
        response.status(403).json({ error: en.forbidden }); return;
      }
      next();
    });
    this.registerSessions();
    this.registerDemo();
    this.app.use('/v1', new InboxController(repository, provider, events, this.sessions).router);
    this.app.use('/v1', (_request, response) => { response.status(404).json({ error: en.missing }); });
    this.app.use(express.static(resolve('dist/client')));
    this.app.get('/{*path}', (_request, response) => response.sendFile(resolve('dist/client/index.html')));
    const errors: ErrorRequestHandler = (_error, _request, response, _next) => {
      response.status(503).json({ error: en.unavailable });
    };
    this.app.use(errors);
  }

  private registerSessions(): void {
    this.app.post('/v1/session', (request, response) => {
      if (Date.now() > this.loginAttempts.resetAt) this.loginAttempts = { count: 0, resetAt: Date.now() + 60000 };
      if (++this.loginAttempts.count > 20) { response.status(429).json({ error: en.unavailable }); return; }
      if (typeof request.body?.password !== 'string' || !this.sessions.matches(request.body.password)) {
        response.status(401).json({ error: en.invalidLogin }); return;
      }
      this.sessions.issue(request, response);
      response.sendStatus(204);
    });
    this.app.delete('/v1/session', (request, response) => {
      this.sessions.clear(request, response);
      response.sendStatus(204);
    });
  }

  private registerDemo(): void {
    this.app.post('/v1/demo/deliver', (request, response) => {
      if (!this.sessions.mailbox(request)) { response.status(401).json({ error: en.unauthorized }); return; }
      if (this.config.mode !== 'demo') { response.status(404).json({ error: en.demoOnly }); return; }
      const { name, deliveryId = randomUUID() } = request.body ?? {};
      if (!Fixtures.names.includes(name) || typeof deliveryId !== 'string' || deliveryId.length > 100) {
        response.status(400).json({ error: en.fixtureHelp }); return;
      }
      this.repository.accept(this.config.mailbox, `${name}:${deliveryId}`, new Date().toISOString());
      this.events.publish(this.config.mailbox);
      response.status(202).json({ accepted: true });
    });
  }
}
