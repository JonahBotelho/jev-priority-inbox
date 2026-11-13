// Reader entry point, session lifecycle, and authoritative snapshot refresh.
import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { Card, Snapshot, Message, Tier } from '../shared/types.js';
import { en } from '../locales/en.js';
import { InboxApi } from './InboxApi.js';
import { InboxQueue } from './InboxQueue.js';
import { MessageReader, type OpenedMessage } from './MessageReader.js';
import './styles.css';
import { ConnectedReader } from './ConnectedReader.js';
import { DemoInbox } from './DemoInbox.js';

function Reader() {
  const [signedIn, setSignedIn] = useState(false);
  const [checking, setChecking] = useState(true);
  const [password, setPassword] = useState('');
  const [snapshot, setSnapshot] = useState<Snapshot>();
  const [opened, setOpened] = useState<OpenedMessage>();
  const [mobileReader, setMobileReader] = useState(false);
  const [error, setError] = useState('');
  const [connected, setConnected] = useState(true);
  const [emergency, setEmergency] = useState(false);
  const [busy, setBusy] = useState(false);
  const known = useRef<Set<string> | null>(null);
  const refreshSequence = useRef(0);
  const messageSequence = useRef(0);
  const queueContainer = useRef<HTMLDivElement>(null);
  const cards = snapshot?.cards ?? [];
  const processing = snapshot?.processing;

  async function refresh() {
    const sequence = ++refreshSequence.current;
    try {
      const result = await InboxApi.request<Snapshot>('/priority');
      if (sequence !== refreshSequence.current) return;
      if (known.current && result.cards.some(card => card.tier === 'Emergency' && !known.current!.has(card.id))) setEmergency(true);
      known.current = new Set(result.cards.map(card => card.id));
      setSnapshot(result);
      setSignedIn(true);
    } catch (cause) {
      if (sequence !== refreshSequence.current) return;
      if ((cause as { status?: number }).status === 401) setSignedIn(false);
      else setError((cause as Error).message);
    } finally { setChecking(false); }
  }

  async function perform(action: () => Promise<void>): Promise<boolean> {
    setBusy(true);
    setError('');
    try { await action(); return true; }
    catch (cause) { setError((cause as Error).message || en.error); return false; }
    finally { setBusy(false); }
  }

  function openMessage(card: Card, focus = true) {
    const sequence = ++messageSequence.current;
    void perform(async () => {
      const message = await InboxApi.request<Message>('/messages/' + card.id);
      if (sequence !== messageSequence.current) return;
      setOpened({ id: card.id, message, tier: card.tier, focus, selection: sequence });
      if (focus) setMobileReader(true);
    });
  }

  function backToInbox() {
    setMobileReader(false);
    requestAnimationFrame(() => queueContainer.current?.querySelector<HTMLButtonElement>('[aria-current="true"]')?.focus());
  }

  useEffect(() => { document.title = en.title; void refresh(); }, []);
  useEffect(() => {
    if (!signedIn) return;
    const stream = new EventSource('/v1/events');
    stream.onopen = () => { setConnected(true); void refresh(); };
    stream.addEventListener('change', () => { void refresh(); });
    stream.onerror = () => setConnected(false);
    return () => stream.close();
  }, [signedIn]);
  // Auto-open only when there is no current message. Arrivals never replace an open reader.
  useEffect(() => {
    if (signedIn && cards[0] && !opened && !busy && !error) openMessage(cards[0], false);
  }, [signedIn, cards[0]?.id, opened?.id, busy, error]);

  if (checking) return <main><p role="status">{en.loading}</p></main>;
  if (!signedIn) return <main className="login">
    <a className="brand" href="/" aria-label={en.title}>{en.brand}<span>{en.brandSubtitle}</span></a>
    <h1>{en.subtitle}</h1>
    <form onSubmit={event => { event.preventDefault(); void perform(async () => {
      await InboxApi.request('/session', 'POST', { password });
      setPassword(''); known.current = null; await refresh();
    }); }}>
      <label htmlFor="password">{en.password}</label>
      <input id="password" type="password" autoComplete="current-password" required value={password} onChange={event => setPassword(event.target.value)}/>
      <button disabled={busy}>{en.signIn}<span aria-hidden="true"> ↗</span></button>
    </form>
    {error && <p role="alert">{error}</p>}
  </main>;

  return <>
    <header><a className="brand" href="/" aria-label={en.title}>{en.brand}<span>{en.brandSubtitle}</span></a>
      <button className="secondary" onClick={() => void perform(async () => {
        await InboxApi.request('/session', 'DELETE'); refreshSequence.current++; messageSequence.current++;
        setSignedIn(false); setSnapshot(undefined); setOpened(undefined); setMobileReader(false); known.current = null;
      })} disabled={busy}>{en.signOut}</button>
    </header>
    <div className="inbox-feedback">
      {!connected && <p className="notice" role="status">{en.connecting}</p>}
      {emergency && <aside className="notice" role="status">{en.newEmergency} <button className="text-button" disabled={busy} onClick={() => {
        const first = cards.find(card => card.tier === 'Emergency');
        if (first) openMessage(first);
        setEmergency(false);
      }}>{en.show}</button></aside>}
      {error && <p role="alert">{error} <button className="text-button" onClick={() => { setError(''); void refresh(); }}>{en.retry}</button></p>}
      {!!processing?.failed && <p className="notice" role="status">{en.delayed}</p>}
      {!!processing?.pending && <p className="processing" role="status">{en.processing}</p>}
    </div>
    <main className={'workspace' + (mobileReader && opened ? ' reader-open' : '')}>
      <div className="queue-container" ref={queueContainer}>
        <InboxQueue cards={cards} selectedId={opened?.id} busy={busy} onOpen={openMessage}/>
      </div>
      <section className="reader-pane" aria-label={en.reader}>
        {opened ? <MessageReader key={opened.id} opened={opened} busy={busy}
          onBack={backToInbox}
          onHandled={() => void perform(async () => {
            await InboxApi.request('/messages/' + opened.id, 'PATCH', { handled: true });
            // Refresh first so the automatic next selection excludes handled mail.
            await refresh(); setOpened(undefined); setMobileReader(false);
          })}
          onCorrect={(tier: Tier) => perform(async () => {
            await InboxApi.request('/messages/' + opened.id, 'PATCH', { correctedTier: tier });
            setOpened(current => current ? { ...current, tier } : current); await refresh();
          })}/>
          : <div className="reader-placeholder">
            {busy ? <p role="status">{en.loading}</p> : snapshot && !processing?.pending && !processing?.failed
              && !cards.length && <><h2>{en.empty}</h2><p>{en.emptyDetail}</p></>}
          </div>}
      </section>
      {!cards.length && !processing?.pending && !processing?.failed && snapshot
        && <div className="mobile-empty"><h2>{en.empty}</h2><p>{en.emptyDetail}</p></div>}
    </main>
  </>;
}

async function start() {
  if (window.location.pathname === '/demo') {
    createRoot(document.getElementById('root')!).render(<React.StrictMode><DemoInbox /></React.StrictMode>);
    return;
  }
  const mode = await InboxApi.request<{ connected: boolean; google?: boolean }>('/mode');
  createRoot(document.getElementById('root')!).render(<React.StrictMode>
    {mode.connected ? <ConnectedReader google={Boolean(mode.google)} /> : <Reader/>}
  </React.StrictMode>);
}
void start().catch(() => {
  createRoot(document.getElementById('root')!).render(<main role="alert">{en.unavailable}</main>);
});
