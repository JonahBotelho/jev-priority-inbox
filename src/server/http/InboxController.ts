// Authenticated inbox routes and event stream lifecycle.
import { Router } from 'express';
import type { MailboxProvider } from '../adapters/Providers.js';
import { ChangeEvents } from '../application/ChangeEvents.js';
import { InboxRepository } from '../infrastructure/InboxRepository.js';
import { Sessions } from './Sessions.js';
import { en } from '../../locales/en.js';
import type { Tier } from '../../shared/types.js';

export class InboxController {
  readonly router = Router();

  constructor(repository: InboxRepository, provider: MailboxProvider, events: ChangeEvents, sessions: Sessions) {
    this.router.use((request, response, next) => {
      const mailbox = sessions.mailbox(request);
      if (!mailbox) { response.status(401).json({ error: en.unauthorized }); return; }
      response.locals.mailbox = mailbox;
      response.setHeader('Cache-Control', 'no-store');
      next();
    });
    this.router.get('/priority', async (_request, response) => {
      const mailbox = response.locals.mailbox;
      // Fill previews for older records without reclassifying or changing handled state.
      const missing = repository.snapshot(mailbox).cards.filter(card => card.preview == null).slice(0, 50);
      await Promise.allSettled(missing.map(async card => {
        const job = repository.find(mailbox, card.id);
        if (!job) return;
        const message = await provider.fetch(job.provider_id, AbortSignal.timeout(4000));
        repository.savePreview(mailbox, card.id, message.text);
      }));
      response.json(repository.snapshot(mailbox));
    });
    this.router.get('/events', (request, response) => {
      response.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'X-Accel-Buffering': 'no' });
      response.flushHeaders();
      const notify = () => response.write('event: change\ndata: {}\n\n');
      const unsubscribe = events.subscribe(response.locals.mailbox, notify);
      const heartbeat = setInterval(() => {
        if (!sessions.mailbox(request)) { response.end(); return; }
        response.write(': heartbeat\n\n');
      }, 15000);
      notify();
      response.on('close', () => { clearInterval(heartbeat); unsubscribe(); });
    });
    this.router.get('/messages/:id', async (request, response) => {
      const job = repository.find(response.locals.mailbox, String(request.params.id));
      if (!job) { response.status(404).json({ error: en.missing }); return; }
      const message = await provider.fetch(job.provider_id, AbortSignal.timeout(4000));
      response.json({ ...message, receivedAt: job.received_at });
    });
    this.router.patch('/messages/:id', (request, response) => {
      const { handled, correctedTier } = request.body ?? {};
      if ((handled !== undefined && handled !== true) || (correctedTier !== undefined
        && !['Emergency', 'Urgent', 'Routine'].includes(correctedTier)) || (handled === undefined && correctedTier === undefined)) {
        response.status(400).json({ error: en.invalid }); return;
      }
      if (!repository.update(response.locals.mailbox, String(request.params.id), handled, correctedTier as Tier)) {
        response.status(404).json({ error: en.missing }); return;
      }
      events.publish(response.locals.mailbox);
      response.sendStatus(204);
    });
  }
}
