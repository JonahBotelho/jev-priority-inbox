// One public reader for demo samples and delivered mail.
import { useEffect, useState } from 'react';
import { en } from '../locales/en.js';
import { portalText } from '../locales/portal.js';
import { priorityInboxText as labels } from '../locales/priorityInbox.js';
import type { ApiUsageQuota, PortalUser } from '../shared/portal.js';
import type { Card, PublicInboxSnapshot, RoutineEmail } from '../shared/types.js';
import { InboxApi } from './InboxApi.js';
import './priority-inbox.css';

const dateFormat = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });
const timeFormat = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });

function InboxNavigation({ isAdmin, usage }: { isAdmin: boolean; usage?: ApiUsageQuota }) {
  const usageText = usage && (usage.limitExceeded
    ? portalText.usageExceededSummary(usage.requests, usage.freeLimit)
    : portalText.usageSummary(usage.requests, usage.freeLimit));

  return <nav className="inbox-portal-nav" aria-label={portalText.portal}>
    {usageText && <span className={`inbox-usage-pill${usage.limitExceeded ? ' exceeded' : ''}`}>{usageText}</span>}
    <a href="/app">{labels.tryEmailDemo}</a>
    {isAdmin && <a className="inbox-admin-link" href="/admin">{portalText.adminDashboard}</a>}
  </nav>;
}

function EmailTime({ receivedAt }: { receivedAt: string }) {
  const received = new Date(receivedAt);
  return <time className="email-time" dateTime={receivedAt} title={received.toLocaleString()}>
    <span>{dateFormat.format(received)}</span>{' '}<span>{timeFormat.format(received)}</span>
  </time>;
}

function EmailRow({ card }: { card: Card }) {
  return <li>
    <details className="priority-email">
      <summary>
        <span className={`priority-tag priority-tag--${card.tier.toLowerCase()}`}>{en.tiers[card.tier]}</span>
        <span className="email-copy">
          <strong className="email-subject">{card.subject}</strong>
          {card.preview && <span className="email-excerpt" aria-hidden="true">{card.preview}</span>}
        </span>
        <EmailTime receivedAt={card.receivedAt} />
        <span className="email-chevron" aria-hidden="true" />
      </summary>
      <p className="email-text">{card.preview || labels.noPreview}</p>
    </details>
  </li>;
}

function InboxNotice({ text, onRetry }: { text: string; onRetry?: () => void }) {
  return <div className="inbox-status" role="status">
    <span>{text}</span>
    {onRetry && <button type="button" onClick={onRetry}>{labels.retry}</button>}
  </div>;
}

function RoutineEmailList({ messages, error, onRetry }: { messages?: RoutineEmail[]; error: boolean; onRetry: () => void }) {
  if (error) return <InboxNotice text={labels.routineError} onRetry={onRetry} />;
  if (!messages) return <InboxNotice text={labels.routineLoading} />;
  if (!messages.length) return <InboxNotice text={labels.routineEmpty} />;
  return <ul className="routine-list">
    {messages.map(email => <li key={email.id}>
      <span>{email.subject ?? labels.subjectUnavailable}</span>
      <EmailTime receivedAt={email.receivedAt} />
    </li>)}
  </ul>;
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
  const [routineExpanded, setRoutineExpanded] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [usage, setUsage] = useState<ApiUsageQuota>();

  useEffect(() => {
    let pendingCheck: AbortController | undefined;
    const stopUsage = InboxApi.onUsageChange(quota => {
      setUsage(current => current && current.requests > quota.requests ? current : quota);
    });

    async function refreshSession() {
      pendingCheck?.abort();
      if (document.hidden) {
        setIsAdmin(false);
        setUsage(undefined);
        return;
      }
      const request = new AbortController();
      pendingCheck = request;
      try {
        const account = await InboxApi.request<PortalUser>('/auth/me', 'GET', undefined, request.signal);
        if (!request.signal.aborted) setIsAdmin(account.role === 'admin');
      } catch {
        if (!request.signal.aborted) {
          setIsAdmin(false);
          setUsage(undefined);
        }
      }
    }

    void refreshSession();
    document.addEventListener('visibilitychange', refreshSession);
    return () => {
      stopUsage();
      pendingCheck?.abort();
      document.removeEventListener('visibilitychange', refreshSession);
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    let loading = false;
    let nextRefresh = 0;
    setLoadError(false);
    async function load() {
      if (loading || controller.signal.aborted || document.hidden) return;
      clearTimeout(timer);
      loading = true;
      try {
        const path = routineExpanded ? '/priority?include=routine' : '/priority';
        const response = await fetch(InboxApi.url(path), { credentials: 'omit', signal: controller.signal });
        if (!response.ok) throw new Error(labels.loadError);
        const snapshot: PublicInboxSnapshot = await response.json();
        if (controller.signal.aborted) return;
        setInbox(snapshot);
        setLoadError(false);
        nextRefresh = snapshot.receivingAddress ? 30000 : 0;
        if (snapshot.reviewAvailable && snapshot.processing.pending > 0) nextRefresh = 1500;
      } catch {
        if (!controller.signal.aborted) setLoadError(true);
        if (nextRefresh) nextRefresh = 30000;
      } finally {
        loading = false;
        if (!controller.signal.aborted && !document.hidden && nextRefresh) timer = setTimeout(load, nextRefresh);
      }
    }
    function onVisibility() {
      if (document.hidden) clearTimeout(timer);
      else void load();
    }
    document.addEventListener('visibilitychange', onVisibility);
    void load();
    return () => {
      controller.abort();
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [attempt, routineExpanded]);

  const routineError = Boolean(loadError && routineExpanded && inbox && !inbox.routineMessages);
  const status = inboxStatus(inbox, loadError && !routineError);
  const retry = () => setAttempt(value => value + 1);
  return <div className="inbox-page">
    <header className="inbox-masthead">
      <div className="inbox-width wordmark"><span className="brand-stamp" aria-hidden="true"><i /></span>{en.brand}
        <InboxNavigation isAdmin={isAdmin} usage={usage} /></div>
    </header>
    <main className="inbox-width">
      {usage?.limitExceeded && <p className="inbox-usage-warning" role="alert">{portalText.freeLimitWarning}</p>}
      <section className="address-panel" aria-label={labels.addressLabel}>
        <div className="address-content">
          <p className="address-label">{labels.addressLabel}</p>
          <p className="inbox-address">{inbox?.receivingAddress
            ? <a href={`mailto:${inbox.receivingAddress}`}>{inbox.receivingAddress}</a> : labels.address}</p>
          <p className="address-hint">{inbox?.receivingAddress ? labels.receivingHint : labels.addressHint}</p>
        </div>
        <span className="address-envelope" aria-hidden="true" />
      </section>
      <section className="priority-section" aria-labelledby="priority-heading">
        <div className="priority-heading">
          <div><h1 id="priority-heading">{labels.heading}</h1>
            <p>{inbox?.receivingAddress ? labels.receivingDescription : labels.description}</p></div>
          {inbox && <span className="message-count">{labels.count(inbox.cards.length)}</span>}
        </div>
        {Boolean(inbox?.cards.length) && <ul className="priority-emails">
          {inbox?.cards.map(card => <EmailRow key={card.id} card={card} />)}
        </ul>}
        {status && <InboxNotice text={status} onRetry={loadError && !routineError ? retry : undefined} />}
        {inbox?.routineCount !== undefined && <div className="routine-group">
          <h2><button type="button" className="routine-toggle" aria-expanded={routineExpanded}
            aria-controls="routine-emails" onClick={() => setRoutineExpanded(value => !value)}>
            {labels.routineHeading}<span className="routine-count">{inbox.routineCount}</span>
          </button></h2>
          <div id="routine-emails" hidden={!routineExpanded}>
            {routineExpanded && <RoutineEmailList messages={inbox.routineMessages} error={routineError} onRetry={retry} />}
          </div>
        </div>}
      </section>
    </main>
  </div>;
}
