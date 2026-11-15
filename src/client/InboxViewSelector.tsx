// Shared segmented view selector positioned directly above each message list.
import { en } from '../locales/en.js';
import './inbox-view-selector.css';

interface Props {
  all: boolean;
  busy: boolean;
  onChange: (all: boolean) => void;
}

export function InboxViewSelector({ all, busy, onChange }: Props) {
  return <div className="inbox-view-selector" role="group" aria-label={en.mail.inboxView}>
    <button type="button" aria-pressed={!all} disabled={busy} onClick={() => onChange(false)}>
      {en.mail.priority}
    </button>
    <button type="button" aria-pressed={all} disabled={busy} onClick={() => onChange(true)}>
      {en.mail.all}
    </button>
  </div>;
}
