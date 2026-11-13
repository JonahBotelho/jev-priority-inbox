// TLS-only manual IMAP/SMTP transport with DNS addresses pinned before connecting.
import { lookup } from 'node:dns/promises';
import ipaddr from 'ipaddr.js';
import { ImapFlow } from 'imapflow';
import nodemailer from 'nodemailer';
import { simpleParser } from 'mailparser';
import { convert } from 'html-to-text';
import type { Account, SyncBatch } from './MailStore.js';
import { MailStore } from './MailStore.js';
import type { ComposeInput, MailDetail, ManualSettings, ServerSettings, SendResult } from '../../shared/mail.js';
import { en } from '../../locales/en.js';
import { MessagePreview } from '../application/MessagePreview.js';

export class ManualTransport {
  constructor(private readonly store: MailStore) {}

  static async destination(host: string): Promise<string> {
    const addresses = await lookup(host, { all: true });
    if (!addresses.length || addresses.some(({ address }) => ipaddr.process(address).range() !== 'unicast')) {
      throw new Error(en.mail.invalidHost);
    }
    return addresses[0].address;
  }

  private async imap(settings: ServerSettings): Promise<ImapFlow> {
    const host = await ManualTransport.destination(settings.host);
    const client = new ImapFlow({ host, port: settings.port, secure: true, servername: settings.host,
      auth: { user: settings.user, pass: settings.password }, logger: false,
      connectionTimeout: 15000, greetingTimeout: 15000, socketTimeout: 30000,
      maxLiteralSize: 5 * 1024 * 1024 });
    try { await client.connect(); return client; }
    catch (error) { client.close(); throw error; }
  }

  private async smtp(settings: ServerSettings) {
    const host = await ManualTransport.destination(settings.host);
    return nodemailer.createTransport({ host, port: settings.port, secure: settings.port === 465,
      requireTLS: settings.port !== 465, tls: { servername: settings.host, rejectUnauthorized: true },
      auth: { user: settings.user, pass: settings.password }, connectionTimeout: 15000,
      greetingTimeout: 15000, socketTimeout: 30000, disableFileAccess: true, disableUrlAccess: true });
  }

  async verify(settings: ManualSettings): Promise<void> {
    try { const client = await this.imap(settings.imap); await client.logout(); }
    catch { throw new Error(en.mail.imapFailed); }
    try { const smtp = await this.smtp(settings.smtp); try { await smtp.verify(); } finally { smtp.close(); } }
    catch { throw new Error(en.mail.smtpFailed); }
  }

  async sync(account: Account, older: boolean): Promise<SyncBatch> {
    const settings = this.store.decrypt<ManualSettings>(account.secret);
    const client = await this.imap(settings.imap);
    try {
      const mailbox = await client.mailboxOpen('INBOX', { readOnly: true });
      const validity = mailbox.uidValidity.toString();
      const previous = account.checkpoint ? JSON.parse(account.checkpoint) : null;
      const reset = previous?.validity !== validity;
      const high = Number(mailbox.uidNext) - 1;
      const found = await client.search({ all: true }, { uid: true });
      const uids = found || [];
      const selected = uids.filter(uid => older && !reset ? uid < Number(account.older)
        : reset ? true : uid > previous.high).sort((a, b) => b - a);
      const page = older || reset ? selected.slice(0, 50) : selected;
      const missing = this.store.missingPreviews(account.id)
        .filter(id => id.startsWith(`${validity}:`)).map(id => Number(id.split(':')[1]));
      const requested = [...new Set([...page, ...missing])].filter(uid => uids.includes(uid));
      const messages = [];
      // Chunking avoids oversized IMAP command lines on a mailbox with a long offline interval.
      for (let index = 0; index < requested.length; index += 50) {
        for await (const message of client.fetch(requested.slice(index, index + 50),
          { envelope: true, internalDate: true, source: { maxLength: 16384 } }, { uid: true })) {
          const text = message.source ? (await ManualTransport.parse(message.source)).text : '';
          messages.push({ providerId: `${validity}:${message.uid}`, subject: message.envelope?.subject ?? '',
            preview: MessagePreview.from(text),
            receivedAt: new Date(message.internalDate || Date.now()).toISOString() });
        }
      }
      return { messages, checkpoint: JSON.stringify({ validity, high }),
        older: selected.length > page.length && page.length ? String(Math.min(...page)) : null,
        activeIds: uids.map(uid => `${validity}:${uid}`), reset };
    } finally { await client.logout().catch(() => client.close()); }
  }

  async read(account: Account, id: string): Promise<MailDetail> {
    const settings = this.store.decrypt<ManualSettings>(account.secret);
    const client = await this.imap(settings.imap);
    try {
      const mailbox = await client.mailboxOpen('INBOX', { readOnly: true });
      const [validity, uid] = id.split(':');
      if (mailbox.uidValidity.toString() !== validity) throw new Error(en.missing);
      const message = await client.fetchOne(uid, { source: true, size: true }, { uid: true });
      if (!message || !message.source || Number(message.size) > 5 * 1024 * 1024) throw new Error(en.missing);
      return ManualTransport.parse(message.source);
    } finally { await client.logout().catch(() => client.close()); }
  }

  static async parse(source: Buffer): Promise<MailDetail> {
    const parsed = await simpleParser(source, { skipHtmlToText: true, skipTextToHtml: true });
    return { subject: parsed.subject ?? '', text: parsed.text || convert(parsed.html || '', { wordwrap: false }),
      from: parsed.from?.text ?? '', receivedAt: (parsed.date ?? new Date()).toISOString(),
      replyTo: parsed.replyTo?.text, messageId: parsed.messageId,
      references: typeof parsed.references === 'string' ? [parsed.references] : parsed.references };
  }

  async send(account: Account, input: ComposeInput, reply?: MailDetail): Promise<SendResult> {
    const settings = this.store.decrypt<ManualSettings>(account.secret);
    const smtp = await this.smtp(settings.smtp);
    try {
      const result = await smtp.sendMail({ from: account.email, to: input.to, cc: input.cc, bcc: input.bcc,
        subject: input.subject, text: input.text, inReplyTo: reply?.messageId,
        references: [...(reply?.references ?? []), ...(reply?.messageId ? [reply.messageId] : [])] });
      return { status: result.rejected.length ? 'partial' : 'sent', rejected: result.rejected.map(String) };
    } catch (error) {
      const code = (error as { responseCode?: number }).responseCode;
      return { status: code && code >= 400 ? 'failed' : 'unknown' };
    } finally { smtp.close(); }
  }
}
