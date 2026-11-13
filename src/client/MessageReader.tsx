// Open message with a top action toolbar and an inline priority correction form.
import { useEffect, useRef, useState } from 'react';
import type { Message, Tier } from '../shared/types.js';
import { en } from '../locales/en.js';

export interface OpenedMessage { id: string; message: Message; tier: Tier; focus: boolean; selection: number }

interface Props {
  opened: OpenedMessage;
  busy: boolean;
  onBack: () => void;
  onHandled: () => void;
  onCorrect: (tier: Tier) => Promise<boolean>;
}

export function MessageReader({ opened, busy, onBack, onHandled, onCorrect }: Props) {
  const [editing, setEditing] = useState(false);
  const [correction, setCorrection] = useState<Tier>(opened.tier);
  const heading = useRef<HTMLHeadingElement>(null);
  const correctionControl = useRef<HTMLSelectElement>(null);
  const correctionButton = useRef<HTMLButtonElement>(null);

  useEffect(() => { if (opened.focus) heading.current?.focus(); }, [opened.selection]);
  useEffect(() => { if (editing) correctionControl.current?.focus(); }, [editing]);

  function closeCorrection() {
    setEditing(false);
    requestAnimationFrame(() => correctionButton.current?.focus());
  }

  return <article className="message">
    <div className="reader-toolbar" aria-label={en.messageActions}>
      <button className="text-button mobile-back" onClick={onBack}>← {en.back}</button>
      <button disabled={busy} onClick={onHandled}>{en.handled}</button>
      <button ref={correctionButton} className="secondary" disabled={busy} aria-expanded={editing} onClick={() => setEditing(value => !value)}>{en.correction}</button>
    </div>
    {editing && <form className="correction-form" onSubmit={event => {
      event.preventDefault();
      void onCorrect(correction).then(saved => { if (saved) closeCorrection(); });
    }}>
      <label>{en.correction}<select ref={correctionControl} value={correction} onChange={event => setCorrection(event.target.value as Tier)}>
        {Object.entries(en.tiers).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select></label>
      <button disabled={busy}>{en.save}</button>
      <button className="text-button" type="button" disabled={busy} onClick={closeCorrection}>{en.cancel}</button>
    </form>}
    <div className="reader-content">
      <span className={`tier ${opened.tier.toLowerCase()}`}>{en.tiers[opened.tier]}</span>
      <h2 ref={heading} tabIndex={-1}>{opened.message.subject}</h2>
      <p className="metadata"><time dateTime={opened.message.receivedAt}>{new Date(opened.message.receivedAt).toLocaleString()}</time>
        <span className="sender">{opened.message.from}</span>
      </p>
      <div className="message-body">{opened.message.text}</div>
    </div>
  </article>;
}
