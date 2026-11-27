// Private account, classifier and administrator pages served alongside the public inbox.
import { useEffect, useState, type FormEvent } from 'react';
import { en } from '../locales/en.js';
import { portalText as labels } from '../locales/portal.js';
import { AdminDashboard } from './AdminDashboard.js';
import { ClassifierDemo } from './ClassifierDemo.js';
import type { PortalUsage, PortalUser } from '../shared/portal.js';
import { InboxApi } from './InboxApi.js';
import { signedInDestination } from './PortalNavigation.js';
import { UsageBanner, type UsageDisplay } from './UsageBanner.js';
import './portal.css';

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
  const [user, setUser] = useState<PortalUser>();
  const [usage, setUsage] = useState<UsageDisplay>();
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

  async function signOut() {
    try { await InboxApi.request('/auth/logout', 'POST'); window.location.replace('/login'); }
    catch (cause) { setError(errorText(cause)); }
  }
  if (!ready) return <main className="portal-loading">{error
    ? <div role="alert">{error} <button className="portal-secondary" onClick={() => setAttempt(n => n + 1)}>{en.retry}</button></div>
    : en.loading}</main>;
  if (!user) return <Login path={path} />;
  return <div className="portal-shell">
    <header className="portal-header"><Brand /><div className="portal-identity">
      <span>{user.email}<small>{user.role === 'admin' ? labels.admin : labels.user}</small></span>
      <button className="portal-secondary" onClick={() => void signOut()}>{labels.signOut}</button></div></header>
    <main className="portal-main"><nav className="portal-tabs" aria-label={labels.portal}>
      <a href="/app" aria-current={path === '/app' ? 'page' : undefined}>{labels.service}</a>
      {user.role === 'admin' && <a href="/admin" aria-current={path === '/admin' ? 'page' : undefined}>{labels.adminDashboard}</a>}
      <a className="portal-inbox-link" href="/">{labels.liveInbox}</a>
    </nav><UsageBanner usage={usage} />{error && <p className="portal-error" role="alert">{error}</p>}
      {path === '/admin' ? <AdminDashboard describeError={privateError} /> : <ClassifierDemo userId={user.id} describeError={privateError} />}
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
