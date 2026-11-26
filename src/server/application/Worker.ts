// Serial durable worker. Jobs are retried once and decisions are committed before notification.
import type { Classifier, MailboxProvider } from '../adapters/Providers.js';
import { ProviderError } from '../adapters/Providers.js';
import { maxMessageLength } from '../../shared/jev.js';
import { priorityInboxText } from '../../locales/priorityInbox.js';
import type { ClassificationInput, Probabilities, Tier } from '../../shared/types.js';
import { PriorityPolicy } from '../../shared/PriorityPolicy.js';
import type { Job, PriorityQueue } from '../infrastructure/PriorityQueue.js';
import { ChangeEvents } from './ChangeEvents.js';
import { MessagePreparation } from './MessagePreparation.js';

interface Decision { subject: string; probabilities: Probabilities | null; tier: Tier; score: number; text?: string }

export class Worker {
  private running = false;
  private readonly preparation = new MessagePreparation();

  constructor(private readonly repository: PriorityQueue, private readonly mailbox: MailboxProvider,
    private readonly classifier: Classifier, private readonly events: ChangeEvents,
    private readonly config: Pick<ClassificationInput, 'role' | 'timeZone'>,
    private readonly source: 'samples' | 'verified-deliveries' = 'samples') {}

  async tick(mailbox?: string): Promise<boolean> {
    if (this.running) return false;
    this.running = true;
    try {
      const job = await this.repository.claim(mailbox);
      if (!job) return false;
      let decision: Decision | undefined;
      try {
        decision = await this.review(job);
      } catch (error) {
        const status = (error as { status?: number }).status;
        const transient = error instanceof ProviderError ? error.transient
          : error instanceof TypeError || ['TimeoutError', 'AbortError', 'APITimeoutError', 'APIConnectionError'].includes((error as Error).name)
            || status === 429 || (status !== undefined && status >= 500);
        await this.repository.fail(job, transient);
      }
      // A lost database connection is a storage failure. Leave the claim recoverable.
      if (decision) await this.repository.complete(job, decision.subject, decision.probabilities, decision.tier, decision.score, decision.text);
      this.events.publish(job.mailbox);
      return true;
    } finally { this.running = false; }
  }

  private async review(job: Job): Promise<Decision> {
    const original = await this.attempt(signal => this.mailbox.fetch(job.provider_id, signal));
    const subject = this.preparation.cleanSubject(original.subject);
    const text = this.preparation.clean(original.text).slice(0, maxMessageLength).trim();
    const sample = this.source === 'samples';
    if ((!subject && !text) || (sample && !this.preparation.approved(subject, text))) {
      return { subject: sample ? subject : '', probabilities: null, tier: 'Routine', score: 0, text: sample ? original.text : undefined };
    }
    const title = subject || priorityInboxText.noSubject;
    const probabilities = await this.attempt(signal => this.classifier.classify({
      subject: title, text: text || subject, receivedAt: job.received_at, ...this.config,
    }, signal));
    const decision = new PriorityPolicy().decide(probabilities);
    const savePreview = sample || decision.tier !== 'Routine';
    const previewSource = sample ? original.text : text;
    return { subject: title, probabilities, ...decision, text: savePreview ? previewSource : undefined };
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
