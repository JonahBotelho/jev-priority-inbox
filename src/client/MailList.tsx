// Compact message queue and mailbox controls shared by account and sample mail.
import type { MailCard } from '../shared/mail.js';
import { en } from '../locales/en.js';
import { InboxViewSelector } from './InboxViewSelector.js';

interface Props {
  cards: MailCard[];
  selectedId?: string;
  all: boolean;
  busy: boolean;
  more: boolean;
  hasOlder: boolean;
  lastSync: string | null;
  onView: (all: boolean) => void;
  onOpen: (card: MailCard) => void;
  onSync: (older?: boolean) => void;
  onMore: () => void;
  onCompose: () => void;
}

export function MailList(props: Props) {
  const labels = en.mail;
  return <aside className="inbox-pane">
    <div className="mail-list-toolbar">
      <h2>{en.inbox}</h2>
      <button className="mobile-compose" disabled={props.busy} onClick={props.onCompose}>{labels.compose}</button>
      <button className="secondary" disabled={props.busy} onClick={() => props.onSync()}>
        <span aria-hidden="true">↻ </span>{labels.refresh}
      </button>
    </div>
    <InboxViewSelector all={props.all} busy={props.busy} onChange={props.onView} />
    {props.lastSync && <p className="mail-sync">{labels.synced} <time dateTime={props.lastSync}>
      {new Date(props.lastSync).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
    </time></p>}
    <nav className="inbox-queue" aria-label={en.inbox}>
      {!props.cards.length && <p className="mail-empty">{props.all ? labels.noMail : labels.empty}
        {!props.all && <button className="text-button" onClick={() => props.onView(true)}>{labels.all}</button>}
      </p>}
      {props.cards.map(card => <button className="queue-item" key={card.id} disabled={props.busy}
        aria-current={props.selectedId === card.id ? 'true' : undefined} onClick={() => props.onOpen(card)}>
        <span className="queue-meta">
          <span className={`tier ${card.tier?.toLowerCase() ?? 'unclassified'}`}>
            {card.tier ? en.tiers[card.tier] : labels.unclassified}
          </span>
          <time dateTime={card.receivedAt}>
            {new Date(card.receivedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
          </time>
        </span>
        <strong title={card.subject}>{card.subject}</strong>
        {card.preview && <span className="message-preview">{card.preview}</span>}
      </button>)}
      {props.more && <button className="mail-load-more secondary" disabled={props.busy} onClick={props.onMore}>{labels.more}</button>}
      {props.all && props.hasOlder && <button className="mail-load-more secondary" disabled={props.busy}
        onClick={() => props.onSync(true)}>{labels.older}</button>}
    </nav>
  </aside>;
}
