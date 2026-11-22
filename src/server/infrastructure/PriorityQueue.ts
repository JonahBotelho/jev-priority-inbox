// The worker also serves the offline SQLite study. A Postgres claim identifies its specific lease.
import type { Probabilities, Tier } from '../../shared/types.js';

export interface Job {
  id: string;
  mailbox: string;
  provider_id: string;
  received_at: string;
  attempts: number;
  claim_token?: string;
}

export interface PriorityQueue {
  claim(mailbox?: string): Job | undefined | Promise<Job | undefined>;
  complete(job: Job, subject: string, probabilities: Probabilities | null, tier: Tier, score: number, text?: string): void | Promise<void>;
  fail(job: Job, transient: boolean): void | Promise<void>;
}
