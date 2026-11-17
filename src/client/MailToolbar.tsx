// Persistent email-panel toolbar, including when no message is selected.
import type { Tier } from '../shared/types.js';
import { en } from '../locales/en.js';

interface Props {
  busy: boolean;
  composing: boolean;
  onBack: () => void;
  onCompose: () => void;
  message?: {
    tier: Tier | null;
    onReply: (all: boolean) => void;
    onHandled: () => void;
    onPriority: (tier: Tier) => void;
  };
}

export function MailToolbar({ busy, composing, onBack, onCompose, message }: Props) {
  const labels = en.mail;
  return <div className="reader-toolbar" aria-label={en.messageActions}>
    <button className="text-button mobile-back" onClick={onBack}>← {en.back}</button>
    <button className="mail-compose-control" disabled={busy || composing} onClick={onCompose}>{labels.compose}</button>
    {message && <>
      <select className="mail-reply-control" aria-label={labels.reply} value="" disabled={busy}
        onChange={event => message.onReply(event.target.value === 'all')}>
        <option value="" disabled hidden>{labels.reply}</option>
        <option value="reply">{labels.reply}</option>
        <option value="all">{labels.replyAll}</option>
      </select>
      <button className="secondary" disabled={busy} onClick={message.onHandled}>{labels.handled}</button>
      <div className="mail-priority-control">
        <select aria-label={labels.correction} value={message.tier ?? ''} disabled={busy}
          onChange={event => message.onPriority(event.target.value as Tier)}>
          <option value="" disabled>{labels.unclassified}</option>
          {Object.entries(en.tiers).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </div>
    </>}
  </div>;
}
