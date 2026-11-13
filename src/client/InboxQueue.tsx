// Compact priority queue shared by the desktop sidebar and mobile inbox.
import type { Card } from '../shared/types.js';
import { en } from '../locales/en.js';

interface Props {
  cards: Card[];
  selectedId?: string;
  busy: boolean;
  onOpen: (card: Card) => void;
}

export function InboxQueue({ cards, selectedId, busy, onOpen }: Props) {
  return <aside className="inbox-pane">
    <div className="inbox-heading"><h1>{en.inbox}</h1></div>
    <nav className="inbox-queue" aria-label={en.inbox}>
      {cards.map(card => <button className="queue-item" key={card.id}
        aria-current={card.id === selectedId ? 'true' : undefined}
        disabled={busy} onClick={() => onOpen(card)}>
        <span className="queue-meta"><span className={`tier ${card.tier.toLowerCase()}`}>{en.tiers[card.tier]}</span>
          <time dateTime={card.receivedAt}>{new Date(card.receivedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</time>
        </span>
        <strong title={card.subject}>{card.subject}</strong>
      </button>)}
    </nav>
  </aside>;
}
