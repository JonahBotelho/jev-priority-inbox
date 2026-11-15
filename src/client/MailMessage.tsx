// Shared reading pane with one toolbar and matching priority controls.
import { useEffect, useRef } from 'react';
import type { MailCard, MailDetail } from '../shared/mail.js';
import type { Tier } from '../shared/types.js';
import { en } from '../locales/en.js';

export interface OpenedMail { card: MailCard; message: MailDetail; focus: boolean; selection: number }

interface Props {
  opened: OpenedMail;
  busy: boolean;
  onBack: () => void;
  onReply: () => void;
  onHandled: () => void;
  onPriority: (tier: Tier) => void;
}

export function MailMessage({ opened, busy, onBack, onReply, onHandled, onPriority }: Props) {
  const heading = useRef<HTMLHeadingElement>(null);
  const labels = en.mail;
  const { card, message } = opened;
  useEffect(() => { if (opened.focus) heading.current?.focus(); }, [opened.selection]);

  return <article className="message">
    <div className="reader-toolbar" aria-label={en.messageActions}>
      <button className="text-button mobile-back" onClick={onBack}>← {en.back}</button>
      <button disabled={busy} onClick={onReply}>{labels.reply}</button>
      <button className="secondary" disabled={busy} onClick={onHandled}>{labels.handled}</button>
      <label className="mail-priority-control">{labels.correction}
        <select value={card.tier ?? ''} disabled={busy} onChange={event => onPriority(event.target.value as Tier)}>
          <option value="" disabled>{labels.unclassified}</option>
          {Object.entries(en.tiers).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </label>
    </div>
    <div className="reader-content">
      <span className={`tier ${card.tier?.toLowerCase() ?? 'unclassified'}`}>
        {card.tier ? en.tiers[card.tier] : labels.unclassified}
      </span>
      <h2 ref={heading} tabIndex={-1}>{message.subject}</h2>
      <p className="metadata">
        <time dateTime={message.receivedAt}>{new Date(message.receivedAt).toLocaleString()}</time>
        <span className="sender">{message.from}</span>
      </p>
      <div className="message-body">{message.text}</div>
    </div>
  </article>;
}
