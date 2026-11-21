// Reviews a bounded set of fictional deliveries. Public reads only return saved Jev decisions.
import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { jevModel, urgencyRubric } from '../../shared/jev.js';
import type { PublicInboxSnapshot } from '../../shared/types.js';
import { Fixtures } from '../adapters/Fixtures.js';
import { type Classifier, DemoMailbox } from '../adapters/Providers.js';
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

  constructor(database: Database, classifier: Classifier | undefined) {
    this.repository = new InboxRepository(database);
    for (const delivery of deliveries) this.repository.accept(publicMailbox, delivery.name, delivery.receivedAt);
    if (classifier) {
      this.repository.recover(publicMailbox);
      this.repository.retryFailed(publicMailbox);
      this.worker = new Worker(this.repository, new DemoMailbox(), classifier, new ChangeEvents(), recipient);
    }
  }

  snapshot(): PublicInboxSnapshot {
    return { ...this.repository.snapshot(publicMailbox, 'model-only'), reviewAvailable: Boolean(this.worker) };
  }

  async reviewPending(signal: AbortSignal): Promise<void> {
    if (!this.worker) return;
    while (!signal.aborted) {
      if (await this.worker.tick(publicMailbox)) continue;
      if (this.snapshot().processing.pending === 0) return;
      // A transient failure has a scheduled retry. Reads never trigger another inference.
      await delay(1000);
    }
  }
}
