// Fictional data adapter: edits last for this preview and sends never contact a provider.
import type { ComposeInput, MailCard, MailDetail, MailStatus, SendResult } from '../shared/mail.js';
import { en } from '../locales/en.js';
import { InboxApi } from './InboxApi.js';
import { Mailbox, type MailChange, type MailPage } from './Mailbox.js';

export class MockMailbox extends Mailbox {
  private cards: MailCard[] = [];
  private loading?: Promise<void>;
  private lastSync = new Date().toISOString();
  private readonly receipts = new Map<string, SendResult>();

  private load(): Promise<void> {
    this.loading ??= InboxApi.request<{ cards: MailCard[] }>('/demo/inbox').then(result => {
      this.cards = result.cards.map(card => ({ ...card, handled: false }));
    }).catch(error => { this.loading = undefined; throw error; });
    return this.loading;
  }

  async account(): Promise<MailStatus> {
    await this.load();
    return { id: 'demo', email: en.mail.demoAddress, error: null, lastSync: this.lastSync,
      hasOlder: false, notice: en.mail.demoNotice };
  }

  async inbox(all: boolean, offset = 0): Promise<MailPage> {
    await this.load();
    const visible = this.cards.filter(card => all || (!card.handled && ['Emergency', 'Urgent'].includes(card.tier ?? '')));
    visible.sort((first, second) => {
      if (!all && first.tier !== second.tier) return first.tier === 'Emergency' ? -1 : 1;
      return Date.parse(second.receivedAt) - Date.parse(first.receivedAt) || first.id.localeCompare(second.id);
    });
    return { cards: visible.slice(offset, offset + 50).map(card => ({ ...card })), more: visible.length > offset + 50 };
  }

  async message(id: string): Promise<MailDetail> {
    const message = await InboxApi.request<MailDetail>(`/demo/messages/${id}`);
    return { ...message, from: en.mail.demoSender, replyTo: en.mail.demoReplyAddress, to: [en.mail.demoAddress], cc: [] };
  }

  async update(id: string, change: MailChange): Promise<void> {
    await this.load();
    const card = this.cards.find(item => item.id === id);
    if (!card) throw new Error(en.missing);
    if (change.correctedTier) card.tier = change.correctedTier;
    if (change.handled) card.handled = true;
  }

  async sync(): Promise<void> {
    await this.load();
    this.lastSync = new Date().toISOString();
  }

  async send(input: ComposeInput): Promise<SendResult> {
    if (!this.receipts.has(input.submissionId)) this.receipts.set(input.submissionId, { status: 'simulated' });
    return this.receipts.get(input.submissionId)!;
  }

  async signOut(): Promise<void> {}

  subscribe(_onChange: () => void): () => void { return () => {}; }
}
