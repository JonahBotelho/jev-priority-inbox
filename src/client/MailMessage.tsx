// Shared message content for demo and connected mailboxes.
import { useEffect, useRef } from 'react';
import type { MailCard, MailDetail } from '../shared/mail.js';
import { en } from '../locales/en.js';

export interface OpenedMail { card: MailCard; message: MailDetail; focus: boolean; selection: number }

export function MailMessage({ opened }: { opened: OpenedMail }) {
  const heading = useRef<HTMLHeadingElement>(null);
  const labels = en.mail;
  const { card, message } = opened;
  useEffect(() => { if (opened.focus) heading.current?.focus(); }, [opened.selection]);

  return <article className="message">
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
