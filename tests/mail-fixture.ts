// In-process provider adapter used only by automated tests, never selected by application configuration.
import { Config } from '../src/server/config.js';
import { Database } from '../src/server/infrastructure/Database.js';
import { MailStore } from '../src/server/mail/MailStore.js';
import { MailService } from '../src/server/mail/MailService.js';
import { ChangeEvents } from '../src/server/application/ChangeEvents.js';
import { ConnectedApplication } from '../src/server/mail/ConnectedApplication.js';
import type { SendResult, MailDetail, ComposeInput } from '../src/shared/mail.js';

export class MailFixture {
  readonly database = new Database(':memory:');
  readonly config: Config;
  readonly store: MailStore;
  readonly service: MailService;
  readonly application: ConnectedApplication;
  sends = 0;
  result: SendResult = { status: 'sent' };
  receivedReply?: MailDetail;
  submitted?: ComposeInput;
  expired = false;
  constructor(publicUrl = 'http://localhost:8000') {
    process.env.APP_MODE = 'connected';
    delete process.env.JEV_API_KEY;
    process.env.SESSION_SECRET = 'test-session-secret-at-least-thirty-two-characters';
    process.env.MAIL_ENCRYPTION_KEY = 'ab'.repeat(32);
    process.env.PUBLIC_URL = publicUrl;
    this.config = new Config();
    this.store = new MailStore(this.database, this.config.encryptionKey);
    this.service = new MailService(this.store, this.config, new ChangeEvents());
    this.service.verify = async () => {};
    this.service.sync = async account => {
      if (this.expired) throw new Error('expired');
      const initial = { providerId: '1', subject: `Mail for ${account.email}`, receivedAt: '2026-11-13T18:00:00Z', preview: 'Please reply.' };
      const arriving = { providerId: '2', subject: 'Arrived during import', receivedAt: '2026-11-13T18:01:00Z', preview: 'Please reply.' };
      return { messages: account.checkpoint ? [initial, arriving] : [initial], checkpoint: '2', older: null, activeIds: ['1', '2'] };
    };
    this.service.read = async () => ({ subject: 'Question', text: 'Please reply.', from: 'Sender <sender@example.test>',
      replyTo: 'Reply Person <reply@example.test>', messageId: '<original@example.test>',
      references: ['<earlier@example.test>'], threadId: 'thread-1', receivedAt: '2026-11-13T18:00:00Z' });
    this.service.send = async (_account, input, reply) => {
      this.sends++; this.receivedReply = reply; this.submitted = input; return this.result;
    };
    this.application = new ConnectedApplication(this.config, this.store, this.service);
  }
  static settings(email = 'person@example.test') {
    return { email, imap: { host: 'imap.example.test', port: 993, user: email, password: 'private-password' },
      smtp: { host: 'smtp.example.test', port: 587, user: email, password: 'private-password' } };
  }
}
