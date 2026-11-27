// Private account, classifier and administrator pages served alongside the public inbox.
import { useCallback, useEffect, useState, type FormEvent, type MouseEvent } from 'react';
import { en } from '../locales/en.js';
import { portalText as labels } from '../locales/portal.js';
import { AdminDashboard } from './AdminDashboard.js';
import { ClassifierDemo } from './ClassifierDemo.js';
import type { PortalHistory, PortalUsage, PortalUser } from '../shared/portal.js';
import { InboxApi } from './InboxApi.js';
import { signedInDestination } from './PortalNavigation.js';
import { UsageBanner, type UsageDisplay } from './UsageBanner.js';
import './portal.css';

interface CachedHistory {
  userId: string;
  rows: PortalHistory[];
  stale: boolean;
}

function parseUsagePayload(payload: unknown): UsageDisplay | undefined {
  if (!payload || typeof payload !== 'object') return undefined;
  const candidate = payload as Partial<PortalUsage>;
  if (typeof candidate.requests !== 'number' || typeof candidate.freeLimit !== 'number'
    || typeof candidate.limitExceeded !== 'boolean') return undefined;
  return {
    requests: candidate.requests,
    freeLimit: candidate.freeLimit,
    remainingFreeCalls: typeof candidate.remainingFreeCalls === 'number'
      ? candidate.remainingFreeCalls : Math.max(0, candidate.freeLimit - candidate.requests),
    limitExceeded: candidate.limitExceeded,
    warning: typeof candidate.warning === 'string' ? candidate.warning : null,
  };
}

const status = (error: unknown) => (error as { status?: number })?.status;
function errorText(error: unknown): string {
  return error instanceof Error && !(error instanceof TypeError) ? error.message : en.unavailable;
}
function privateError(error: unknown): string {
  if (status(error) === 401) window.location.replace('/login');
  return errorText(error);
}
function Brand() {
  return <a className="portal-brand" href="/">{en.brand} <span>{en.brandSubtitle}</span></a>;
}

export function Portal({ path }: { path: string }) {
  const [activePath, setActivePath] = useState(path);
  const [user, setUser] = useState<PortalUser>();
  const [usage, setUsage] = useState<UsageDisplay>();
  const [historyCache, setHistoryCache] = useState<CachedHistory>();
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const authPage = path === '/login' || path === '/register';
  useEffect(() => InboxApi.onUsageChange(quota => {
    setUsage(current => {
      if (current && current.requests > quota.requests) return current;
      return {
        ...quota,
        warning: quota.limitExceeded ? (current?.warning || labels.freeLimitWarning) : null,
      };
    });
  }), []);
  useEffect(() => {
    const restored = (event: PageTransitionEvent) => { if (event.persisted) window.location.reload(); };
    window.addEventListener('pageshow', restored);
    return () => window.removeEventListener('pageshow', restored);
  }, []);
  useEffect(() => {
    const onPopState = () => {
      const next = window.location.pathname.replace(/\/+$/, '');
      if (next === '/app' || (next === '/admin' && user?.role === 'admin')) setActivePath(next);
      else window.location.reload();
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [user?.role]);
  useEffect(() => {
    const controller = new AbortController();
    setError('');
    InboxApi.request<PortalUser>('/auth/me', 'GET', undefined, controller.signal).then(account => {
      if (controller.signal.aborted) return;
      const destination = signedInDestination(path, account.role);
      if (destination !== path) { window.location.replace(destination); return; }
      setUser(account); setReady(true);
    }).catch(cause => {
      if (controller.signal.aborted) return;
      if (status(cause) === 401) {
        setUsage(undefined);
        if (authPage) setReady(true);
        else window.location.replace('/login');
      } else setError(errorText(cause));
    });
    return () => controller.abort();
  }, [path, authPage, attempt]);
  useEffect(() => {
    if (!user) return;
    const controller = new AbortController();
    InboxApi.request<PortalUsage>('/usage/me', 'GET', undefined, controller.signal)
      .then(summary => {
        if (controller.signal.aborted) return;
        const parsed = parseUsagePayload(summary);
        if (!parsed) return;
        setUsage(current => current && current.requests > parsed.requests ? current : parsed);
      })
      .catch(() => { /* Usage display stays resilient during staggered deploys or transient errors. */ });
    return () => controller.abort();
  }, [user]);

  const userId = user?.id;
  const cacheHistory = useCallback((rows: PortalHistory[]) => {
    if (!userId) return;
    setHistoryCache({ userId, rows, stale: false });
  }, [userId]);

  const invalidateHistoryCache = useCallback(() => {
    setHistoryCache(current => current ? { ...current, stale: true } : undefined);
  }, []);

  function navigateTab(event: MouseEvent<HTMLAnchorElement>, target: '/app' | '/admin') {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    if (target === '/admin' && user?.role !== 'admin') return;
    if (target === activePath) return;
    window.history.pushState(null, '', target);
    setActivePath(target);
  }

  async function signOut() {
    try { await InboxApi.request('/auth/logout', 'POST'); window.location.replace('/login'); }
    catch (cause) { setError(errorText(cause)); }
  }
  if (!ready) return <main className="portal-loading">{error
    ? <div role="alert">{error} <button className="portal-secondary" onClick={() => setAttempt(n => n + 1)}>{en.retry}</button></div>
    : en.loading}</main>;
  if (!user) return <Login path={path} />;
  const cachedSavedRows = historyCache && historyCache.userId === user.id && !historyCache.stale ? historyCache.rows : undefined;
  return <div className="portal-shell">
    <header className="portal-header"><Brand /><div className="portal-identity">
      <span>{user.email}<small>{user.role === 'admin' ? labels.admin : labels.user}</small></span>
      <button className="portal-secondary" onClick={() => void signOut()}>{labels.signOut}</button></div></header>
    <main className="portal-main"><nav className="portal-tabs" aria-label={labels.portal}>
      <a href="/app" aria-current={activePath === '/app' ? 'page' : undefined} onClick={event => navigateTab(event, '/app')}>{labels.service}</a>
      {user.role === 'admin' && <a href="/admin" aria-current={activePath === '/admin' ? 'page' : undefined} onClick={event => navigateTab(event, '/admin')}>{labels.adminDashboard}</a>}
      <a className="portal-inbox-link" href="/">{labels.liveInbox}</a>
    </nav><UsageBanner usage={usage} />{error && <p className="portal-error" role="alert">{error}</p>}
      {activePath === '/admin' ? <AdminDashboard describeError={privateError} /> : (
        <ClassifierDemo userId={user.id} describeError={privateError} cachedSavedRows={cachedSavedRows}
          onCacheHistory={cacheHistory} onInvalidateHistoryCache={invalidateHistoryCache} />
      )}
    </main>
  </div>;
}

function Login({ path }: { path: string }) {
  const registering = path === '/register';
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true); setError('');
    const fields = new FormData(event.currentTarget);
    try {
      await InboxApi.request(registering ? '/auth/register' : '/auth/login', 'POST', { email: fields.get('email'), password: fields.get('password') });
      // Verify the browser received the cookie before navigating between the two hosted origins.
      const user = await InboxApi.request<PortalUser>('/auth/me').catch(cause => {
        if (status(cause) === 401) throw new Error(labels.cookieError);
        throw cause;
      });
      window.location.replace(signedInDestination(path, user.role));
    } catch (cause) { setError(errorText(cause)); setBusy(false); }
  }
  return <main className="portal-auth-page"><Brand /><section className="portal-card">
    <h1>{registering ? labels.registerHeading : labels.loginHeading}</h1><p className="portal-muted">{labels.authHelp}</p>
    <form className="portal-form" onSubmit={submit}>
      <label>{labels.email}<input name="email" type="email" autoComplete="email" maxLength={254} required /></label>
      <label>{labels.password}<input name="password" type="password" autoComplete={registering ? 'new-password' : 'current-password'} minLength={registering ? 3 : 1} maxLength={256} required /></label>
      {registering && <small>{en.passwordRequirement}</small>}
      <button disabled={busy}>{busy ? labels.working : registering ? labels.register : labels.signIn}</button>
    </form>{error && <p className="portal-error" role="alert">{error}</p>}
    <a className="portal-link-button" href={registering ? '/login' : '/register'}>{registering ? labels.toLogin : labels.toRegister}</a>
  </section></main>;
}
