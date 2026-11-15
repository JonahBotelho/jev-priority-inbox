// Shared mailbox operations keep the reader independent of its data source.
import type { ComposeInput, MailCard, MailDetail, MailStatus, SendResult } from '../shared/mail.js';
import type { Tier } from '../shared/types.js';
import { InboxApi } from './InboxApi.js';

export interface MailPage { cards: MailCard[]; more: boolean }
export interface MailChange { correctedTier?: Tier; handled?: true }

export abstract class Mailbox {
  abstract account(): Promise<MailStatus>;
  abstract inbox(all: boolean, offset?: number): Promise<MailPage>;
  abstract message(id: string): Promise<MailDetail>;
  abstract update(id: string, change: MailChange): Promise<void>;
  abstract sync(older?: boolean): Promise<void>;
  abstract send(input: ComposeInput): Promise<SendResult>;
  abstract signOut(): Promise<void>;
  abstract subscribe(onChange: () => void): () => void;
}

export class AccountMailbox extends Mailbox {
  account(): Promise<MailStatus> { return InboxApi.request('/account'); }

  inbox(all: boolean, offset = 0): Promise<MailPage> {
    return InboxApi.request(`/inbox?view=${all ? 'all' : 'priority'}&offset=${offset}`);
  }

  message(id: string): Promise<MailDetail> { return InboxApi.request(`/messages/${id}`); }

  update(id: string, change: MailChange): Promise<void> {
    return InboxApi.request(`/messages/${id}`, 'PATCH', change);
  }

  sync(older = false): Promise<void> { return InboxApi.request('/sync', 'POST', { older }); }

  send(input: ComposeInput): Promise<SendResult> { return InboxApi.request('/messages/send', 'POST', input); }

  signOut(): Promise<void> { return InboxApi.request('/session', 'DELETE'); }

  subscribe(onChange: () => void): () => void {
    const stream = new EventSource('/v1/events');
    stream.addEventListener('change', onChange);
    return () => stream.close();
  }
}
