// One inbox interface for both connected accounts and fictional sample data.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { MailCard, MailStatus } from '../shared/mail.js';
import type { Tier } from '../shared/types.js';
import { en } from '../locales/en.js';
import type { Mailbox } from './Mailbox.js';
import { ConnectMailbox } from './ConnectMailbox.js';
import { ComposeMail } from './ComposeMail.js';
import { MailList } from './MailList.js';
import { MailMessage, type OpenedMail } from './MailMessage.js';
import './mailbox.css';

export function MailboxReader({ mailbox, google }: { mailbox: Mailbox; google: boolean }) {
  const [account, setAccount] = useState<MailStatus>();
  const [checked, setChecked] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  const [all, setAll] = useState(false);
  const [loadedView, setLoadedView] = useState<boolean>();
  const [cards, setCards] = useState<MailCard[]>([]);
  const [more, setMore] = useState(false);
  const [opened, setOpened] = useState<OpenedMail>();
  const [compose, setCompose] = useState<{ reply?: { id: string; message: OpenedMail['message'] } }>();
  const [mobileReader, setMobileReader] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const refreshSequence = useRef(0);
  const messageSequence = useRef(0);
  const queue = useRef<HTMLDivElement>(null);
  const labels = en.mail;

  const refresh = useCallback(async () => {
    const sequence = ++refreshSequence.current;
    try {
      const [status, result] = await Promise.all([mailbox.account(), mailbox.inbox(all)]);
      if (sequence !== refreshSequence.current) return;
      setAccount(status); setCards(result.cards); setMore(result.more); setLoadedView(all);
    } catch (cause) {
      if (sequence !== refreshSequence.current) return;
      if ((cause as { status?: number }).status === 401) {
        setAccount(undefined); setOpened(undefined); setCompose(undefined); setCards([]);
      } else setError((cause as Error).message);
    } finally { if (sequence === refreshSequence.current) setChecked(true); }
  }, [mailbox, all]);

  useEffect(() => { document.title = en.title; void refresh(); }, [refresh]);
  useEffect(() => {
    if (account) return mailbox.subscribe(() => { void refresh(); });
  }, [mailbox, account?.id, refresh]);
  useEffect(() => {
    // Load the selected view before auto-opening; updates never replace the current message.
    if (account && loadedView === all && cards[0] && !opened && !compose && !busy && !error) {
      void openMessage(cards[0], false);
    }
  }, [account?.id, loadedView, all, cards[0]?.id, opened?.card.id, compose, busy, error]);

  async function perform(operation: () => Promise<unknown>) {
    setBusy(true); setError('');
    try { await operation(); } catch (cause) { setError((cause as Error).message); }
    finally { setBusy(false); }
  }

  async function openMessage(card: MailCard, focus = true) {
    const selection = ++messageSequence.current;
    await perform(async () => {
      const message = await mailbox.message(card.id);
      if (selection !== messageSequence.current) return;
      setOpened({ card, message, focus, selection }); setCompose(undefined); setMobileReader(focus);
    });
  }

  function backToInbox() {
    setMobileReader(false);
    requestAnimationFrame(() => queue.current?.querySelector<HTMLButtonElement>('[aria-current="true"]')?.focus());
  }

  async function correctPriority(tier: Tier) {
    if (!opened) return;
    await mailbox.update(opened.card.id, { correctedTier: tier });
    setOpened(current => current && { ...current, card: { ...current.card, tier } });
    await refresh();
  }

  if (!checked) return <main>{en.loading}</main>;
  if (!account || reconnecting) return <ConnectMailbox google={google}
    onConnected={() => { setReconnecting(false); void refresh(); }} />;

  return <div className="mail-shell">
    <header>
      <a className="brand" href="/" aria-label={en.title}>{en.brand}<span>{en.brandSubtitle}</span></a>
      <div className="mail-account"><span>{account.email}</span><div className="mail-actions">
        <button disabled={busy} onClick={() => { setCompose({}); setMobileReader(true); }}>{labels.compose}</button>
        <button className="secondary" disabled={busy} onClick={() => void perform(async () => {
          await mailbox.signOut(); window.location.assign('/');
        })}>{labels.signOut}</button>
      </div></div>
    </header>
    <div className="inbox-feedback">
      {account.notice && <p className="mail-notice">{account.notice}</p>}
      {error && <p role="alert">{error}</p>}
      {account.error && <p role="alert">{account.error} <button className="text-button"
        onClick={() => setReconnecting(true)}>{labels.reconnect}</button></p>}
    </div>
    <main className={'workspace' + (mobileReader ? ' reader-open' : '')}>
      <div className="queue-container" ref={queue}>
        <MailList cards={cards} selectedId={opened?.card.id} all={all} busy={busy} more={more}
          hasOlder={account.hasOlder} lastSync={account.lastSync}
          onView={value => { setAll(value); setOpened(undefined); setMobileReader(false); }}
          onOpen={card => { void openMessage(card); }}
          onSync={older => void perform(async () => { await mailbox.sync(older); await refresh(); })}
          onMore={() => void perform(async () => {
            const page = await mailbox.inbox(all, cards.length);
            setCards(current => [...current, ...page.cards]); setMore(page.more);
          })} />
      </div>
      <section className="reader-pane" aria-label={en.reader}>
        {compose ? <><button className="text-button mobile-back compose-back" onClick={backToInbox}>← {en.back}</button>
          <ComposeMail mailbox={mailbox} key={compose.reply?.id ?? 'new'} reply={compose.reply}
            onClose={() => { setCompose(undefined); if (!opened) setMobileReader(false); }} /></>
          : opened ? <MailMessage opened={opened} busy={busy} onBack={backToInbox}
            onReply={() => setCompose({ reply: { id: opened.card.id, message: opened.message } })}
            onHandled={() => void perform(async () => {
              await mailbox.update(opened.card.id, { handled: true }); await refresh();
              setOpened(undefined); setMobileReader(false);
            })}
            onPriority={tier => void perform(() => correctPriority(tier))} />
            : <div className="reader-placeholder"><p>{labels.selectMessage}</p></div>}
      </section>
    </main>
  </div>;
}
