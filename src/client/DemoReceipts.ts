// Keep only signed result metadata until the API confirms it. Each tab can retry independently.
import { demoHistoryEntry, type DemoReceipt } from '../shared/portal.js';
import { InboxApi } from './InboxApi.js';

export class DemoReceipts {
  private readonly prefix: string;
  private readonly pending = new Map<string, DemoReceipt>();
  private syncing?: Promise<boolean>;

  constructor(userId: string) {
    this.prefix = `jev.demo.${userId}.`;
    try {
      for (const key of Object.keys(localStorage)) {
        if (!key.startsWith(this.prefix)) continue;
        try {
          const receipt: DemoReceipt = JSON.parse(localStorage.getItem(key) ?? 'null');
          const { id, model, createdAt } = demoHistoryEntry(receipt.inference);
          if (receipt.inference.userId === userId && key === this.prefix + id && typeof model === 'string'
            && Number.isFinite(Date.parse(createdAt)) && typeof receipt.signature === 'string') this.pending.set(id, receipt);
        } catch { /* Skip incomplete local records. Saved history still comes from the API. */ }
      }
    } catch { /* Storage can be unavailable in private browsing. Keep this tab's receipts in memory. */ }
  }

  get history() {
    return Array.from(this.pending.values(), receipt => demoHistoryEntry(receipt.inference));
  }

  add(receipt: DemoReceipt): void {
    const { id } = receipt.inference;
    this.pending.set(id, receipt);
    try { localStorage.setItem(this.prefix + id, JSON.stringify(receipt)); }
    catch { /* The relay also saves its copy if this tab closes. */ }
  }

  sync(): Promise<boolean> {
    if (!this.pending.size) return Promise.resolve(true);
    return this.syncing ??= this.deliverPending().finally(() => { this.syncing = undefined; });
  }

  private async deliverPending(): Promise<boolean> {
    // Iterating the map also picks up submissions made while an earlier receipt is in flight.
    for (const [id, receipt] of this.pending) {
      try {
        await InboxApi.request('/demo/receipts', 'POST', receipt, AbortSignal.timeout(15000));
        this.pending.delete(id);
        try { localStorage.removeItem(this.prefix + id); } catch { /* Replays are idempotent. */ }
      } catch { /* Retry the receipt on reconnect, reload or an explicit retry. */ }
    }
    return this.pending.size === 0;
  }
}
