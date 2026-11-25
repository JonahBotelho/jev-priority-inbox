// Verify Resend delivery events and retrieve content only for the public receiving address.
import { Resend } from 'resend';
import { convert } from 'html-to-text';
import type { Message } from '../../shared/types.js';
import { priorityInboxText } from '../../locales/priorityInbox.js';
import { ProviderError, type MailboxProvider } from './Providers.js';

const emailIdPattern = /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i;
interface SignatureHeaders { id: string; timestamp: string; signature: string }
type Delivery = { id: string; receivedAt: string };
type WebhookResult = { status: 200 | 400 | 401; delivery?: Delivery };

export class ResendMailbox implements MailboxProvider {
  readonly address = priorityInboxText.receivingAddress;
  private readonly client: Resend;

  constructor(apiKey: string, private readonly signingSecret: string) {
    this.client = new Resend(apiKey);
  }

  static fromEnvironment(env: NodeJS.ProcessEnv = process.env): ResendMailbox | undefined {
    const apiKey = env.RESEND_API_KEY?.trim();
    const secret = env.RESEND_WEBHOOK_SECRET?.trim();
    return apiKey && secret ? new ResendMailbox(apiKey, secret) : undefined;
  }

  verify(raw: Buffer, headers: SignatureHeaders): WebhookResult {
    let event;
    try {
      event = this.client.webhooks.verify({ payload: raw.toString('utf8'), headers, webhookSecret: this.signingSecret });
    } catch {
      return { status: 401 };
    }
    if (!event || typeof event.type !== 'string') return { status: 400 };
    if (event.type !== 'email.received') return { status: 200 };
    const data = event.data;
    if (!data || !Array.isArray(data.received_for)) return { status: 400 };
    if (!this.isRecipient(data.received_for)) return { status: 200 };
    if (typeof data.email_id !== 'string' || !emailIdPattern.test(data.email_id)
      || typeof data.created_at !== 'string' || !Number.isFinite(Date.parse(data.created_at))) return { status: 400 };
    return { status: 200, delivery: { id: data.email_id.toLowerCase(), receivedAt: new Date(data.created_at).toISOString() } };
  }

  private async verifiedEmail(id: string, signal: AbortSignal) {
    if (!emailIdPattern.test(id)) throw new ProviderError(false);
    const { data, error } = await this.client.emails.receiving.get(id, { html_format: 'cid' }, { signal });
    if (error) {
      const status = error.statusCode;
      throw new ProviderError(status == null || status === 429 || status >= 500);
    }
    if (data?.id?.toLowerCase() !== id || !this.isRecipient(data.received_for)) throw new ProviderError(false);
    return data;
  }

  async fetchSubject(id: string, signal: AbortSignal): Promise<string> {
    const email = await this.verifiedEmail(id, signal);
    return email.subject ?? '';
  }

  async fetch(id: string, signal: AbortSignal): Promise<Message> {
    const data = await this.verifiedEmail(id, signal);
    const text = data.text?.trim() || convert(data.html ?? '', {
      wordwrap: false,
      selectors: [
        { selector: 'a', options: { ignoreHref: true } }, { selector: 'img', format: 'skip' },
        { selector: 'blockquote', format: 'skip' }, { selector: '.gmail_quote', format: 'skip' },
        { selector: '.gmail_signature', format: 'skip' },
      ],
    });
    return { subject: data.subject ?? '', text, from: '', receivedAt: data.created_at };
  }

  private isRecipient(envelope: unknown): boolean {
    return Array.isArray(envelope) && envelope.some(value => typeof value === 'string' && value.trim().toLowerCase() === this.address);
  }
}
