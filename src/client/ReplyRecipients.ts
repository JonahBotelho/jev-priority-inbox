// Builds reply recipients consistently for demo and connected mailboxes.
import type { MailDetail } from '../shared/mail.js';

export class ReplyRecipients {
  static for(message: MailDetail, accountEmail: string, all: boolean): { to: string; cc: string } {
    const target = message.replyTo || message.from;
    const sender = target.match(/[^\s<>@,]+@[^\s<>@,]+\.[^\s<>@,]+/g) ?? [];
    const seen = new Set<string>(all ? [accountEmail.trim().toLowerCase()] : []);
    const unique = (addresses: string[]) => addresses.filter(address => {
      const key = address.trim().toLowerCase();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    }).join(', ');

    // Process To first so an address present in both headers is never copied to Cc.
    const to = unique(all ? [...sender, ...(message.to ?? [])] : sender);
    const cc = unique(all ? message.cc ?? [] : []);
    return { to, cc };
  }
}
