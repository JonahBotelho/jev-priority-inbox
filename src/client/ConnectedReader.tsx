// Connected-account inbox, on-demand reader and compose/reply workflow.
import { useCallback, useEffect, useState } from 'react';
import type { MailCard, MailDetail, MailStatus } from '../shared/mail.js';
import { en } from '../locales/en.js';
import { InboxApi } from './InboxApi.js';
import { ConnectMailbox } from './ConnectMailbox.js';
import { ComposeMail } from './ComposeMail.js';
import { InboxViewSelector } from './InboxViewSelector.js';

export function ConnectedReader({ google }: { google: boolean }) {
  const [account, setAccount] = useState<MailStatus>();
  const [checked, setChecked] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  const [view, setView] = useState('priority');
  const [loadedView, setLoadedView] = useState('');
  const [cards, setCards] = useState<MailCard[]>([]);
  const [more, setMore] = useState(false);
  const [opened, setOpened] = useState<{ card: MailCard; message: MailDetail }>();
  const [compose, setCompose] = useState<{ reply?: { id: string; message: MailDetail } }>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const labels = en.mail;

  const refresh = useCallback(async () => {
    try {
      const status = await InboxApi.request<MailStatus>('/account'); setAccount(status);
      const result = await InboxApi.request<{ cards: MailCard[]; more: boolean }>(`/inbox?view=${view}`);
      setCards(result.cards); setMore(result.more); setLoadedView(view);
    } catch (cause) {
      if ((cause as { status?: number }).status === 401) { setAccount(undefined); setOpened(undefined); setCompose(undefined); setCards([]); }
      else setError((cause as Error).message);
    } finally { setChecked(true); }
  }, [view]);
  useEffect(() => { document.title = en.title; void refresh(); }, [refresh]);
  useEffect(() => {
    if (!account) return;
    const stream = new EventSource('/v1/events');
    stream.addEventListener('change', () => { void refresh(); });
    return () => stream.close();
  }, [account?.id, refresh]);

  useEffect(() => {
    // Wait for the selected view's snapshot, and preserve an open message on live updates.
    if (account && loadedView === view && cards[0] && !opened && !compose && !busy && !error) {
      void openMessage(cards[0]);
    }
  }, [account?.id, loadedView, view, cards[0]?.id, opened?.card.id, compose, busy, error]);

  async function openMessage(card: MailCard) {
    await perform(async () => {
      const message = await InboxApi.request<MailDetail>(`/messages/${card.id}`);
      setOpened({ card, message }); setCompose(undefined);
    });
  }

  async function perform(operation: () => Promise<unknown>) {
    setBusy(true); setError('');
    try { await operation(); } catch (cause) { setError((cause as Error).message); }
    finally { setBusy(false); }
  }
  async function sync(older = false) { await InboxApi.request('/sync', 'POST', { older }); await refresh(); }
  if (!checked) return <main>{en.loading}</main>;
  if (!account || reconnecting) return <ConnectMailbox google={google} onConnected={() => { setReconnecting(false); void refresh(); }} />;

  return <><header><h1>{en.title}</h1><span>{account.email}</span><div className="mail-actions">
    <button onClick={() => setCompose({})}>{labels.compose}</button>
    <button className="secondary" disabled={busy} onClick={() => void perform(async () => {
      await InboxApi.request('/session', 'DELETE'); await refresh();
    })}>{labels.signOut}</button>
    <button className="secondary" disabled={busy} onClick={() => {
      if (window.confirm(labels.disconnectConfirm)) void perform(async () => { await InboxApi.request('/account', 'DELETE'); await refresh(); });
    }}>{labels.disconnect}</button>
  </div></header>
    <div className="mail-tabs">
      <button className="secondary" disabled={busy} onClick={() => void perform(() => sync())}>{labels.refresh}</button>
    </div>
    {error && <p role="alert">{error}</p>}
    {account.error && <p role="alert">{account.error} <button onClick={() => setReconnecting(true)}>{labels.reconnect}</button></p>}
    {account.lastSync && <p className="mail-sync">{labels.synced} {new Date(account.lastSync).toLocaleString()}</p>}
    <main className="mail-workspace"><aside className="inbox-pane">
      <InboxViewSelector all={view === 'all'} busy={busy} onChange={all => {
        setView(all ? 'all' : 'priority'); setOpened(undefined);
      }} />
      {!cards.length && <p>{view === 'priority' ? labels.empty : labels.noMail}
        {view === 'priority' && <button className="text-button" onClick={() => setView('all')}>{labels.all}</button>}</p>}
      {cards.map(card => <button className="queue-item" key={card.id} disabled={busy} aria-current={opened?.card.id === card.id}
        onClick={() => { void openMessage(card); }}><span>{card.tier ? en.tiers[card.tier] : labels.unclassified}</span><strong>{card.subject}</strong>
        {card.preview && <span className="message-preview">{card.preview}</span>}
        <time>{new Date(card.receivedAt).toLocaleString()}</time></button>)}
      {more && <button disabled={busy} onClick={() => void perform(async () => {
        const page = await InboxApi.request<{ cards: MailCard[]; more: boolean }>(`/inbox?view=${view}&offset=${cards.length}`);
        setCards(current => [...current, ...page.cards]); setMore(page.more);
      })}>{labels.more}</button>}
      {view === 'all' && account.hasOlder && <button disabled={busy} onClick={() => void perform(() => sync(true))}>{labels.older}</button>}
    </aside>
      {compose ? <ComposeMail key={compose.reply?.id ?? 'new'} reply={compose.reply} onClose={() => setCompose(undefined)} />
        : opened && <article className="message"><div className="mail-actions">
          <button onClick={() => setCompose({ reply: { id: opened.card.id, message: opened.message } })}>{labels.reply}</button>
          <button className="secondary" disabled={busy} onClick={() => void perform(async () => {
            await InboxApi.request(`/messages/${opened.card.id}`, 'PATCH', { handled: true }); await refresh();
          })}>{labels.handled}</button>
          <label>{labels.correction}<select value={opened.card.tier ?? ''} disabled={busy} onChange={event => {
            const correctedTier = event.target.value as NonNullable<MailCard['tier']>;
            void perform(async () => { await InboxApi.request(`/messages/${opened.card.id}`, 'PATCH', { correctedTier });
              setOpened({ ...opened, card: { ...opened.card, tier: correctedTier } }); await refresh(); });
          }}><option value="" disabled>{labels.unclassified}</option>
            {Object.entries(en.tiers).map(([key, value]) => <option key={key} value={key}>{value}</option>)}
          </select></label>
        </div><h2>{opened.message.subject}</h2><p>{opened.message.from}</p>
          <div className="message-body">{opened.message.text}</div></article>}
    </main></>;
}
