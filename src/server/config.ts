// Validated process configuration. Provider credentials stay on the server.
import 'dotenv/config';
import { en } from '../locales/en.js';

export class Config {
  readonly port = Number(process.env.PORT ?? 8000);
  readonly databasePath = process.env.SQLITE_PATH ?? './data/mail.sqlite';
  readonly encryptionKey = process.env.MAIL_ENCRYPTION_KEY ?? '';
  readonly googleClientId = process.env.GOOGLE_CLIENT_ID ?? '';
  readonly googleClientSecret = process.env.GOOGLE_CLIENT_SECRET ?? '';
  readonly publicUrl = process.env.PUBLIC_URL ?? `http://localhost:${this.port}`;

  constructor() {
    if (!Number.isInteger(this.port) || this.port < 1 || this.port > 65535
      || !/^[a-fA-F0-9]{64}$/.test(this.encryptionKey)) {
      throw new Error(en.config);
    }
  }
}
