// Serialize account operations so sync, disconnect and sends cannot race each other.
import { MailStore, type Account } from './MailStore.js';
import { ManualTransport } from './ManualTransport.js';
import { GoogleTransport } from './GoogleTransport.js';
import type { MailTransport } from './MailTransport.js';
import type { Config } from '../config.js';
import { ChangeEvents } from '../application/ChangeEvents.js';
import { en } from '../../locales/en.js';

export class MailService implements MailTransport {
  private readonly locks = new Map<string, Promise<unknown>>();
  readonly google: GoogleTransport;
  private readonly manual: ManualTransport;
  constructor(readonly store: MailStore, config: Config, readonly events: ChangeEvents) {
    this.google = new GoogleTransport(store, config);
    this.manual = new ManualTransport(store);
  }
  exclusive<T>(id: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.locks.get(id) ?? Promise.resolve();
    const next = previous.catch(() => {}).then(operation);
    this.locks.set(id, next);
    void next.finally(() => { if (this.locks.get(id) === next) this.locks.delete(id); }).catch(() => {});
    return next;
  }
  private transport(account: Account) { return account.kind === 'google' ? this.google : this.manual; }
  verify: MailTransport['verify'] = settings => this.manual.verify(settings);
  sync: MailTransport['sync'] = (account, older) => this.transport(account).sync(account, older);
  read: MailTransport['read'] = (account, id) => this.transport(account).read(account, id);
  send: MailTransport['send'] = (account, input, reply) => this.transport(account).send(account, input, reply);
  revoke: MailTransport['revoke'] = async account => { if (account.kind === 'google') await this.google.revoke(account); };

  async refresh(id: string, older = false): Promise<void> {
    await this.exclusive(id, async () => {
      const account = this.store.account(id);
      if (!account || (older && !account.older)) return;
      try {
        this.store.commit(id, await this.sync(account, older), older);
        if (!account.checkpoint && !older && this.store.account(id)) {
          this.store.commit(id, await this.sync(this.store.account(id)!, false));
        }
      }
      catch {
        this.store.database.connection.prepare('UPDATE mail_accounts SET error=? WHERE id=?').run(en.mail.syncFailed, id);
      }
      this.events.publish(id);
    });
  }
  async tick(): Promise<void> {
    for (const account of this.store.accounts()) await this.refresh(account.id);
  }
}
