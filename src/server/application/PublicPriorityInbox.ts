// The same public reader uses either verified Resend deliveries or the isolated sample mailbox.
import { createHash } from 'node:crypto';
import { EventEmitter, once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { jevModel, urgencyRubric } from '../../shared/jev.js';
import { en } from '../../locales/en.js';
import type { PublicInboxSnapshot } from '../../shared/types.js';
import { Fixtures } from '../adapters/Fixtures.js';
import { type Classifier, DemoMailbox } from '../adapters/Providers.js';
import type { ResendMailbox } from '../adapters/ResendMailbox.js';
import type { PostgresInbox } from '../infrastructure/PostgresInbox.js';
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
  private readonly worker?: Worker;
  private readonly mailbox: string;
  private readonly arrivals = new EventEmitter();
  private deliveryVersion = 0;

  private constructor(private readonly repository: PostgresInbox, classifier?: Classifier, readonly receiving?: ResendMailbox) {
    this.mailbox = receiving ? `resend/${receiving.address}` : publicMailbox;
    if (classifier) {
      this.worker = new Worker(this.repository, receiving ?? new DemoMailbox(), classifier, new ChangeEvents(),
        recipient, receiving ? 'verified-deliveries' : 'samples');
    }
  }

  static async open(repository: PostgresInbox, classifier?: Classifier, receiving?: ResendMailbox): Promise<PublicPriorityInbox> {
    const inbox = new PublicPriorityInbox(repository, classifier, receiving);
    if (!receiving) {
      for (const delivery of deliveries) await repository.accept(inbox.mailbox, delivery.name, delivery.receivedAt);
    }
    if (classifier) await repository.retryFailed(inbox.mailbox);
    return inbox;
  }

  async snapshot(): Promise<PublicInboxSnapshot> {
    return { ...await this.repository.snapshot(this.mailbox), reviewAvailable: Boolean(this.worker),
      ...(this.receiving && { receivingAddress: this.receiving.address }) };
  }

  async acceptDelivery(id: string, receivedAt: string): Promise<void> {
    if (!this.receiving) throw new Error('Receiving is not configured');
    await this.repository.accept(this.mailbox, id, receivedAt);
    this.deliveryVersion++;
    this.arrivals.emit('delivery');
  }

  async run(signal: AbortSignal): Promise<void> {
    while (!signal.aborted) {
      const version = this.deliveryVersion;
      try {
        await this.reviewPending(signal);
      } catch {
        console.error(en.databaseUnavailable);
        await delay(5000, undefined, { signal }).catch(() => {});
        continue;
      }
      if (!this.receiving || !this.worker || signal.aborted) return;
      // A delivery may commit while the last asynchronous queue read is in flight.
      if (version !== this.deliveryVersion) continue;
      try { await once(this.arrivals, 'delivery', { signal }); }
      catch (error) { if (!signal.aborted) throw error; }
    }
  }

  async reviewPending(signal: AbortSignal): Promise<void> {
    if (!this.worker) return;
    while (!signal.aborted) {
      if (await this.worker.tick(this.mailbox)) continue;
      if (!await this.repository.hasPending(this.mailbox)) return;
      // A delayed retry or another worker's claim will become eligible without a new webhook.
      await delay(1000, undefined, { signal }).catch(() => {});
    }
  }
}
