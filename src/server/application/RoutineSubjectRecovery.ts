// Restore titles for older, already-reviewed deliveries independently of the live classification queue.
import { setTimeout as delay } from 'node:timers/promises';
import { en } from '../../locales/en.js';
import { priorityInboxText } from '../../locales/priorityInbox.js';
import { ProviderError } from '../adapters/Providers.js';
import type { ResendMailbox } from '../adapters/ResendMailbox.js';
import type { PostgresInbox } from '../infrastructure/PostgresInbox.js';
import { MessagePreparation } from './MessagePreparation.js';

export class RoutineSubjectRecovery {
  private readonly preparation = new MessagePreparation();

  constructor(private readonly store: PostgresInbox, private readonly receiving: ResendMailbox) {}

  async run(mailbox: string, signal: AbortSignal): Promise<void> {
    let missedSubject = false;
    for await (const id of this.store.missingRoutineSubjectIds(mailbox)) {
      if (signal.aborted) return;
      let original: string;
      try {
        original = await this.readSubject(id, signal);
      } catch {
        if (signal.aborted) return;
        missedSubject = true;
        continue;
      }
      const subject = this.preparation.cleanSubject(original) || priorityInboxText.noSubject;
      await this.store.restoreRoutineSubject(mailbox, id, subject);
    }
    if (missedSubject) console.warn(en.routineSubjectRecoveryFailed);
  }

  private async readSubject(id: string, signal: AbortSignal): Promise<string> {
    const read = () => this.receiving.fetchSubject(id, AbortSignal.any([signal, AbortSignal.timeout(4000)]));
    try {
      return await read();
    } catch (error) {
      if (signal.aborted || !(error instanceof ProviderError && error.transient)) throw error;
      await delay(1000, undefined, { signal });
      return read();
    }
  }
}
