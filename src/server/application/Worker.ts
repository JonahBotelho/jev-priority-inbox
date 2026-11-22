// Serial durable worker. Jobs are retried once and decisions are committed before notification.
import type { Classifier, MailboxProvider } from '../adapters/Providers.js';
import { ProviderError } from '../adapters/Providers.js';
import { maxMessageLength, maxSubjectLength } from '../../shared/jev.js';
import { priorityInboxText } from '../../locales/priorityInbox.js';
import type { ClassificationInput } from '../../shared/types.js';
import { PriorityPolicy } from '../domain/PriorityPolicy.js';
import { InboxRepository, type Job } from '../infrastructure/InboxRepository.js';
import { ChangeEvents } from './ChangeEvents.js';
import { MessagePreparation } from './MessagePreparation.js';

export class Worker {
  private running = false;
  private readonly preparation = new MessagePreparation();

  constructor(private readonly repository: InboxRepository, private readonly mailbox: MailboxProvider,
    private readonly classifier: Classifier, private readonly events: ChangeEvents,
    private readonly config: Pick<ClassificationInput, 'role' | 'timeZone'>,
    private readonly source: 'samples' | 'verified-deliveries' = 'samples') {}

  async tick(mailbox?: string): Promise<boolean> {
    if (this.running) return false;
    this.running = true;
    try {
      const job = this.repository.claim(mailbox);
      if (!job) return false;
      try {
        await this.review(job);
      } catch (error) {
        const status = (error as { status?: number }).status;
        const transient = error instanceof ProviderError ? error.transient
          : error instanceof TypeError || ['TimeoutError', 'AbortError', 'APITimeoutError', 'APIConnectionError'].includes((error as Error).name)
            || status === 429 || (status !== undefined && status >= 500);
        this.repository.fail(job, transient);
      }
      this.events.publish(job.mailbox);
      return true;
    } finally { this.running = false; }
  }

  private async review(job: Job): Promise<void> {
    const original = await this.attempt(signal => this.mailbox.fetch(job.provider_id, signal));
    const subject = this.preparation.clean(original.subject).slice(0, maxSubjectLength).trim();
    const text = this.preparation.clean(original.text).slice(0, maxMessageLength).trim();
    const sample = this.source === 'samples';
    if ((!subject && !text) || (sample && !this.preparation.approved(subject, text))) {
      this.repository.complete(job.id, sample ? subject : '', null, 'Routine', 0, sample ? original.text : undefined);
      return;
    }
    const title = subject || priorityInboxText.noSubject;
    const probabilities = await this.attempt(signal => this.classifier.classify({
      subject: title, text: text || subject, receivedAt: job.received_at, ...this.config,
    }, signal));
    const decision = new PriorityPolicy().decide(probabilities);
    const saveContent = sample || decision.tier !== 'Routine';
    const previewSource = sample ? original.text : text;
    this.repository.complete(job.id, saveContent ? title : '', probabilities, decision.tier, decision.score,
      saveContent ? previewSource : undefined);
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
