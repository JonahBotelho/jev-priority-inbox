// Validated process configuration. Provider credentials stay on the server.
import 'dotenv/config';
import { en } from '../locales/en.js';

export class Config {
  readonly mode = process.env.APP_MODE ?? 'demo';
  readonly port = Number(process.env.PORT ?? 8000);
  readonly databasePath = process.env.SQLITE_PATH ?? './data/inbox.sqlite';
  readonly mailbox = process.env.MAILBOX_ADDRESS ?? 'team@example.test';
  readonly password = process.env.MAILBOX_PASSWORD ?? '';
  readonly secret = process.env.SESSION_SECRET ?? '';
  readonly role = process.env.RECIPIENT_ROLE ?? 'On-call service owner';
  readonly timeZone = process.env.RECIPIENT_TIME_ZONE ?? 'America/Vancouver';
  readonly resendKey = process.env.RESEND_API_KEY ?? '';
  readonly webhookSecret = process.env.RESEND_WEBHOOK_SECRET ?? '';
  readonly jevKey = process.env.JEV_API_KEY ?? '';

  constructor() {
    const liveMissing = this.mode === 'live' && (!this.resendKey || !this.webhookSecret || !this.jevKey);
    if (!['demo', 'live'].includes(this.mode) || !Number.isInteger(this.port) || this.port < 1 || this.port > 65535
      || !this.password || this.secret.length < 32 || !this.mailbox.includes('@') || liveMissing
      || (this.mode === 'live' && (this.password === 'classroom-demo' || this.secret.startsWith('replace-')))) {
      throw new Error(en.config);
    }
    new Intl.DateTimeFormat('en', { timeZone: this.timeZone });
  }
}
