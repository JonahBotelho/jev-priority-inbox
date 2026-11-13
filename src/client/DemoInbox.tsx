// Read-only fictional inbox available without a mailbox login.
import { useEffect, useState } from 'react';
import type { Card, Message, Snapshot } from '../shared/types.js';
import { en } from '../locales/en.js';
import { InboxApi } from './InboxApi.js';
import { InboxQueue } from './InboxQueue.js';
import { InboxViewSelector } from './InboxViewSelector.js';

export function DemoInbox() {
  const [cards, setCards] = useState<Card[]>([]);
  const [all, setAll] = useState(false);
  const [opened, setOpened] = useState<{ card: Card; message: Message }>();
  const [mobileReader, setMobileReader] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const visible = cards.filter(card => all || card.tier !== 'Routine').sort((first, second) =>
    ['Emergency', 'Urgent', 'Routine'].indexOf(first.tier) - ['Emergency', 'Urgent', 'Routine'].indexOf(second.tier));

  useEffect(() => {
    document.title = en.mail.demoTitle;
    void InboxApi.request<Snapshot>('/demo/inbox').then(result => setCards(result.cards))
      .catch(cause => setError(cause.message));
  }, []);

  useEffect(() => {
    if (visible[0] && !opened && !busy && !error) void open(visible[0], false);
  }, [visible[0]?.id, opened?.card.id, busy, error]);

  async function open(card: Card, showReader = true) {
    setBusy(true); setError('');
    try {
      const message = await InboxApi.request<Message>(`/demo/messages/${card.id}`);
      setOpened({ card, message }); setMobileReader(showReader);
    } catch (cause) { setError((cause as Error).message); }
    finally { setBusy(false); }
  }

  return <>
    <header><a className="brand" href="/" aria-label={en.title}>{en.brand}<span>{en.brandSubtitle}</span></a>
      <a className="text-button" href="/">{en.mail.backToSignIn}</a>
    </header>
    {error && <p role="alert">{error}</p>}
    <main className={'workspace' + (mobileReader && opened ? ' reader-open' : '')}>
      <div className="queue-container"><InboxQueue cards={visible} busy={busy} selectedId={opened?.card.id}
        onOpen={card => { void open(card); }}
        viewSelector={<InboxViewSelector all={all} busy={busy} onChange={value => { setAll(value); setMobileReader(false); }} />} /></div>
      <section className="reader-pane" aria-label={en.reader}>
        {opened && <article className="message">
          <div className="reader-toolbar demo-reader-toolbar">
            <button className="text-button mobile-back" onClick={() => setMobileReader(false)}>← {en.back}</button>
          </div>
          <div className="reader-content">
            <span className={`tier ${opened.card.tier.toLowerCase()}`}>{en.tiers[opened.card.tier]}</span>
            <h2>{opened.message.subject}</h2>
            <p className="metadata"><time dateTime={opened.message.receivedAt}>{new Date(opened.message.receivedAt).toLocaleString()}</time>
              <span>{opened.message.from}</span></p>
            <div className="message-body">{opened.message.text}</div>
          </div>
        </article>}
      </section>
    </main>
  </>;
}
