// The same public reader uses either verified Resend deliveries or the isolated sample mailbox.
import { createHash } from 'node:crypto';
import { EventEmitter, once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { jevModel, urgencyRubric } from '../../shared/jev.js';
import type { PublicInboxSnapshot } from '../../shared/types.js';
import { Fixtures } from '../adapters/Fixtures.js';
import { type Classifier, DemoMailbox } from '../adapters/Providers.js';
import type { ResendMailbox } from '../adapters/ResendMailbox.js';
import type { Database } from '../infrastructure/Database.js';
import { InboxRepository } from '../infrastructure/InboxRepository.js';
import { ChangeEvents } from './ChangeEvents.js';
import { Worker } from './Worker.js';

const recipient = { role: 'On-call service owner', timeZone: 'America/Vancouver' };
const sampleMorning = Date.parse('2026-11-20T18:10:00Z');
const deliveries = Fixtures.names.map((name, index) => ({
  name, receivedAt: new Date(sampleMorning - index * 7 * 60000).toISOString(), ...Fixtures.get(name),
}));
// A changed model, rubric, or email needs a fresh decision. Personal mail has its own namespace.
const revision = createHash('sha256').update(JSON.stringify([jevModel, urgencyRubric, recipient, deliveries])).digest('hex');
const publicMailbox = `public-demo/${revision}`;

export class PublicPriorityInbox {
  private readonly repository: InboxRepository;
  private readonly worker?: Worker;
  private readonly mailbox: string;
  private readonly arrivals = new EventEmitter();

  constructor(database: Database, classifier: Classifier | undefined, readonly receiving?: ResendMailbox) {
    this.repository = new InboxRepository(database);
    this.mailbox = receiving ? `resend/${receiving.address}` : publicMailbox;
    if (!receiving) {
      for (const delivery of deliveries) this.repository.accept(this.mailbox, delivery.name, delivery.receivedAt);
    }
    if (classifier) {
      this.repository.recover(this.mailbox);
      this.repository.retryFailed(this.mailbox);
      this.worker = new Worker(this.repository, receiving ?? new DemoMailbox(), classifier, new ChangeEvents(),
        recipient, receiving ? 'verified-deliveries' : 'samples');
    }
  }

  snapshot(): PublicInboxSnapshot {
    return { ...this.repository.snapshot(this.mailbox, 'model-only'), reviewAvailable: Boolean(this.worker),
      ...(this.receiving && { receivingAddress: this.receiving.address }) };
  }

  acceptDelivery(id: string, receivedAt: string): void {
    if (!this.receiving) throw new Error('Receiving is not configured');
    if (this.repository.accept(this.mailbox, id, receivedAt)) this.arrivals.emit('delivery');
  }

  async run(signal: AbortSignal): Promise<void> {
    while (!signal.aborted) {
      await this.reviewPending(signal);
      if (!this.receiving || !this.worker || signal.aborted) return;
      // Recheck the durable queue before installing the listener in the same event-loop turn.
      if (this.repository.processing(this.mailbox).pending) continue;
      try { await once(this.arrivals, 'delivery', { signal }); }
      catch (error) { if (!signal.aborted) throw error; }
    }
  }

  async reviewPending(signal: AbortSignal): Promise<void> {
    if (!this.worker) return;
    while (!signal.aborted) {
      if (await this.worker.tick(this.mailbox)) continue;
      if (this.repository.processing(this.mailbox).pending === 0) return;
      // A transient failure has a scheduled retry. Reads never trigger another inference.
      await delay(1000);
    }
  }
}
