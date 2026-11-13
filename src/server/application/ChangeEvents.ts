// Mailbox-scoped invalidation events. Clients always reload an authoritative snapshot.
import { EventEmitter } from 'node:events';

export class ChangeEvents {
  private readonly emitter = new EventEmitter();

  publish(mailbox: string): void { this.emitter.emit(mailbox); }

  subscribe(mailbox: string, listener: () => void): () => void {
    this.emitter.on(mailbox, listener);
    return () => { this.emitter.off(mailbox, listener); };
  }
}
