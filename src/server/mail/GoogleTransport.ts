// Gmail API access with refreshed OAuth tokens and durable history checkpoints.
import { OAuth2Client } from 'google-auth-library';
import nodemailer from 'nodemailer';
import type { Config } from '../config.js';
import { MailStore, type Account, type Incoming, type SyncBatch } from './MailStore.js';
import { ManualTransport } from './ManualTransport.js';
import type { ComposeInput, MailDetail, SendResult } from '../../shared/mail.js';
import { convert } from 'html-to-text';
import { MessagePreview } from '../application/MessagePreview.js';

interface GmailMessage { id: string; threadId: string; internalDate: string; raw?: string; snippet?: string;
  payload?: { headers: { name: string; value: string }[] } }
interface HistoryPage { historyId: string; nextPageToken?: string;
  history?: { messagesAdded?: { message: { id: string } }[]; labelsAdded?: { message: { id: string }; labelIds: string[] }[] }[] }

export class GoogleTransport {
  private readonly clients = new Map<string, { secret: string; client: OAuth2Client }>();
  constructor(private readonly store: MailStore, private readonly config: Config) {}

  oauth(): OAuth2Client {
    return new OAuth2Client(this.config.googleClientId, this.config.googleClientSecret,
      `${this.config.publicUrl}/v1/connect/google/callback`);
  }

  private client(account: Account): OAuth2Client {
    const cached = this.clients.get(account.id);
    if (cached?.secret === account.secret) return cached.client;
    const client = this.oauth();
    client.setCredentials(this.store.decrypt(account.secret));
    this.clients.set(account.id, { secret: account.secret, client });
    return client;
  }

  protected async request<T>(account: Account, path: string, data?: unknown): Promise<T> {
    const response = await this.client(account).request<T>({ url: `https://gmail.googleapis.com/gmail/v1/users/me/${path}`,
      method: data ? 'POST' : 'GET', data, timeout: 15000,
      retry: false });
    return response.data;
  }

  private async ids(account: Account): Promise<string[]> {
    const ids: string[] = [];
    let pageToken = '';
    do {
      const page = await this.request<{ messages?: { id: string }[]; nextPageToken?: string }>(account,
        `messages?labelIds=INBOX&maxResults=500&pageToken=${encodeURIComponent(pageToken)}`);
      ids.push(...(page.messages ?? []).map(message => message.id));
      pageToken = page.nextPageToken ?? '';
    } while (pageToken);
    return ids;
  }

  private async metadata(account: Account, ids: string[]): Promise<Incoming[]> {
    const messages: Incoming[] = [];
    for (const id of ids) {
      try {
        const message = await this.request<GmailMessage>(account, `messages/${encodeURIComponent(id)}?format=metadata&metadataHeaders=Subject`);
        messages.push({ providerId: message.id, receivedAt: new Date(Number(message.internalDate)).toISOString(),
          preview: MessagePreview.from(convert(message.snippet ?? '', { wordwrap: false })),
          subject: message.payload?.headers.find(header => header.name.toLowerCase() === 'subject')?.value ?? '' });
      } catch (error) { if ((error as { status?: number }).status !== 404) throw error; }
    }
    return messages;
  }

  private async changes(account: Account, checkpoint: string): Promise<{ ids: string[]; checkpoint: string }> {
    const ids = new Set<string>();
    let token = '';
    let latest = checkpoint;
    do {
      const page = await this.request<HistoryPage>(account,
        `history?startHistoryId=${checkpoint}&pageToken=${encodeURIComponent(token)}`);
      for (const history of page.history ?? []) {
        for (const entry of history.messagesAdded ?? []) ids.add(entry.message.id);
        for (const entry of history.labelsAdded ?? []) if (entry.labelIds.includes('INBOX')) ids.add(entry.message.id);
      }
      latest = page.historyId;
      token = page.nextPageToken ?? '';
    } while (token);
    return { ids: [...ids], checkpoint: latest };
  }

  async sync(account: Account, older: boolean): Promise<SyncBatch> {
    const profile = await this.request<{ historyId: string }>(account, 'profile');
    let checkpoint = account.checkpoint ?? profile.historyId;
    let reset = !account.checkpoint;
    let changes: string[] = [];
    if (!older) {
      try { const result = await this.changes(account, checkpoint); changes = result.ids; checkpoint = result.checkpoint; }
      catch (error) {
        if ((error as { status?: number }).status !== 404) throw error;
        reset = true; checkpoint = profile.historyId;
      }
    }
    let ids = changes;
    let next: string | null = account.older;
    if (reset || older) {
      const page = await this.request<{ messages?: { id: string }[]; nextPageToken?: string }>(account,
        `messages?labelIds=INBOX&maxResults=50${older && account.older ? `&pageToken=${encodeURIComponent(account.older)}` : ''}`);
      ids = [...ids, ...(page.messages ?? []).map(message => message.id)];
      next = page.nextPageToken ?? null;
    }
    // Listing active IDs reconciles moves/deletions even after history expiration.
    const activeIds = await this.ids(account);
    const messages = await this.metadata(account, [...new Set([...ids, ...this.store.missingPreviews(account.id)])]
      .filter(id => activeIds.includes(id)));
    if (reset && !older) {
      const caught = await this.changes(account, checkpoint);
      messages.push(...await this.metadata(account, caught.ids));
      checkpoint = caught.checkpoint;
      return { messages, checkpoint, older: next, activeIds: await this.ids(account), reset };
    }
    return { messages, checkpoint, older: next, activeIds, reset };
  }

  async read(account: Account, id: string): Promise<MailDetail> {
    const message = await this.request<GmailMessage>(account, `messages/${encodeURIComponent(id)}?format=raw`);
    if (!message.raw || message.raw.length > 7 * 1024 * 1024) throw new Error('Message size');
    const source = Buffer.from(message.raw, 'base64url');
    if (source.length > 5 * 1024 * 1024) throw new Error('Message size');
    return { ...await ManualTransport.parse(source), threadId: message.threadId,
      receivedAt: new Date(Number(message.internalDate)).toISOString() };
  }

  async send(account: Account, input: ComposeInput, reply?: MailDetail): Promise<SendResult> {
    // Gmail reads envelope recipients from this raw MIME, then strips Bcc on delivery.
    const builder = nodemailer.createTransport({ streamTransport: true, buffer: true });
    const options = { from: account.email, to: input.to, cc: input.cc, bcc: input.bcc,
      subject: input.subject, text: input.text, inReplyTo: reply?.messageId,
      references: [...(reply?.references ?? []), ...(reply?.messageId ? [reply.messageId] : [])], keepBcc: true };
    const message = await builder.sendMail(options);
    try {
      if (!Buffer.isBuffer(message.message)) throw new Error('MIME buffer unavailable');
      await this.request(account, 'messages/send', { raw: message.message.toString('base64url'), threadId: reply?.threadId });
      return { status: 'sent' };
    } catch (error) {
      const status = (error as { status?: number }).status;
      return { status: status && status >= 400 && status < 500 ? 'failed' : 'unknown' };
    }
  }

  async revoke(account: Account): Promise<void> {
    try { await this.client(account).revokeCredentials(); }
    catch (error) {
      // A previously revoked token already satisfies disconnect's revocation requirement.
      if ((error as { status?: number }).status !== 400) throw error;
    }
    this.clients.delete(account.id);
  }
}
