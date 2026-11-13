// Serial durable worker. Jobs are retried once and decisions are committed before notification.
import type { Classifier, MailboxProvider } from '../adapters/Providers.js';
import { ProviderError } from '../adapters/Providers.js';
import { Config } from '../config.js';
import { PriorityPolicy } from '../domain/PriorityPolicy.js';
import { InboxRepository } from '../infrastructure/InboxRepository.js';
import { ChangeEvents } from './ChangeEvents.js';
import { MessagePreparation } from './MessagePreparation.js';

export class Worker {
  private running = false;
  private readonly preparation = new MessagePreparation();

  constructor(private readonly repository: InboxRepository, private readonly mailbox: MailboxProvider,
    private readonly classifier: Classifier, private readonly events: ChangeEvents,
    private readonly config: Pick<Config, 'role' | 'timeZone'>) {}

  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const job = this.repository.claim();
      if (!job) return;
      try {
        const original = await this.attempt(signal => this.mailbox.fetch(job.provider_id, signal));
        const subject = this.preparation.clean(original.subject);
        const text = this.preparation.clean(original.text);
        if (!this.preparation.approved(subject, text)) {
          this.repository.complete(job.id, subject, null, 'Routine', 0, original.text);
        } else {
          const probabilities = await this.attempt(signal => this.classifier.classify({ subject, text,
            receivedAt: job.received_at, role: this.config.role, timeZone: this.config.timeZone }, signal));
          const decision = new PriorityPolicy().decide(probabilities);
          this.repository.complete(job.id, subject, probabilities, decision.tier, decision.score, original.text);
        }
      } catch (error) {
        const status = (error as { status?: number }).status;
        const transient = error instanceof ProviderError ? error.transient
          : error instanceof TypeError || ['TimeoutError', 'AbortError', 'APITimeoutError', 'APIConnectionError'].includes((error as Error).name)
            || status === 429 || (status !== undefined && status >= 500);
        this.repository.fail(job, transient);
      }
      this.events.publish(job.mailbox);
    } finally { this.running = false; }
  }

  private async attempt<T>(operation: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new DOMException('Provider timeout', 'TimeoutError'));
      }, 4000);
    });
    try { return await Promise.race([operation(controller.signal), deadline]); }
    finally { clearTimeout(timer!); }
  }
}
