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
  readonly clientOrigin = process.env.CLIENT_ORIGIN ?? 'http://localhost:5173';
  readonly jwtSecret = process.env.APP_JWT_SECRET ?? '';
  readonly initialAdminEmail = process.env.INITIAL_ADMIN_EMAIL?.trim().toLowerCase() ?? '';
  readonly initialAdminPassword = process.env.INITIAL_ADMIN_PASSWORD ?? '';
  readonly jevApiKey = process.env.JEV_API_KEY ?? '';

  constructor() {
    if (!Number.isInteger(this.port) || this.port < 1 || this.port > 65535
      || !/^[a-fA-F0-9]{64}$/.test(this.encryptionKey)
      || !/^[a-fA-F0-9]{64}$/.test(this.jwtSecret)
      || !/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(this.initialAdminEmail)
      || this.initialAdminPassword.length < 12
      || !this.validOrigin(this.clientOrigin)) {
      throw new Error(en.config);
    }
  }

  private validOrigin(value: string): boolean {
    try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) && url.origin === value; }
    catch { return false; }
  }
}
