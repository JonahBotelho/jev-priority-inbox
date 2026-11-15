// Provider boundary shared by live transports and integration-test adapters.
import type { ComposeInput, MailDetail, ManualSettings, SendResult } from '../../shared/mail.js';
import type { Account, SyncBatch } from './MailStore.js';

export interface MailTransport {
  verify(settings: ManualSettings): Promise<void>;
  sync(account: Account, older: boolean): Promise<SyncBatch>;
  read(account: Account, providerId: string): Promise<MailDetail>;
  send(account: Account, input: ComposeInput, reply?: MailDetail): Promise<SendResult>;
  revoke(account: Account): Promise<void>;
}
