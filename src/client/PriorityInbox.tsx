// One public list for the home page and inbox links. Each row opens in place to read the sample.
import { useEffect, useState } from 'react';
import { en } from '../locales/en.js';
import { priorityInboxText as labels } from '../locales/priorityInbox.js';
import type { Card, PublicInboxSnapshot } from '../shared/types.js';
import { InboxApi } from './InboxApi.js';
import './priority-inbox.css';

const dateFormat = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });
const timeFormat = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });

function EmailRow({ card }: { card: Card }) {
  const received = new Date(card.receivedAt);
  return <li>
    <details className="priority-email">
      <summary>
        <span className={`priority-tag priority-tag--${card.tier.toLowerCase()}`}>{en.tiers[card.tier]}</span>
        <span className="email-copy">
          <strong className="email-subject">{card.subject}</strong>
          {card.preview && <span className="email-excerpt" aria-hidden="true">{card.preview}</span>}
        </span>
        <time className="email-time" dateTime={card.receivedAt}>
          <span>{dateFormat.format(received)}</span>{' '}<span>{timeFormat.format(received)}</span>
        </time>
        <span className="email-chevron" aria-hidden="true" />
      </summary>
      {card.preview && <p className="email-text">{card.preview}</p>}
    </details>
  </li>;
}

function inboxStatus(inbox: PublicInboxSnapshot | undefined, loadError: boolean) {
  if (loadError) return labels.loadError;
  if (!inbox) return labels.loading;
  if (inbox.processing.pending) return inbox.reviewAvailable ? labels.reviewing : labels.unavailable;
  if (inbox.processing.failed) return labels.failed;
  if (!inbox.cards.length) return labels.empty;
  return undefined;
}

export function PriorityInbox() {
  const [inbox, setInbox] = useState<PublicInboxSnapshot>();
  const [loadError, setLoadError] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    setLoadError(false);
    async function load() {
      try {
        const response = await fetch(InboxApi.url('/priority'), { credentials: 'omit', signal: controller.signal });
        if (!response.ok) throw new Error(labels.loadError);
        const snapshot: PublicInboxSnapshot = await response.json();
        if (controller.signal.aborted) return;
        setInbox(snapshot);
        if (snapshot.reviewAvailable && snapshot.processing.pending > 0) timer = setTimeout(load, 1500);
      } catch {
        if (!controller.signal.aborted) setLoadError(true);
      }
    }
    void load();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [attempt]);

  const status = inboxStatus(inbox, loadError);
  return <div className="inbox-page">
    <header className="inbox-masthead">
      <div className="inbox-width wordmark"><span className="brand-stamp" aria-hidden="true"><i /></span>{en.brand}</div>
    </header>
    <main className="inbox-width">
      <section className="address-panel" aria-label={labels.addressLabel}>
        <div className="address-content">
          <p className="address-label">{labels.addressLabel}</p>
          <p className="inbox-address">{labels.address}</p>
          <p className="address-hint">{labels.addressHint}</p>
        </div>
        <span className="address-envelope" aria-hidden="true" />
      </section>
      <section className="priority-section" aria-labelledby="priority-heading">
        <div className="priority-heading">
          <div><h1 id="priority-heading">{labels.heading}</h1><p>{labels.description}</p></div>
          {inbox && <span className="message-count">{labels.count(inbox.cards.length)}</span>}
        </div>
        {Boolean(inbox?.cards.length) && <ul className="priority-emails">
          {inbox?.cards.map(card => <EmailRow key={card.id} card={card} />)}
        </ul>}
        {status && <div className="inbox-status" role="status">
          <span>{status}</span>
          {loadError && <button type="button" onClick={() => setAttempt(value => value + 1)}>{labels.retry}</button>}
        </div>}
      </section>
    </main>
  </div>;
}
