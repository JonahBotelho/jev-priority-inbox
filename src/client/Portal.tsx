// Private account, classifier and administrator pages served alongside the public inbox.
import { useEffect, useState, type FormEvent } from 'react';
import { en } from '../locales/en.js';
import { portalText as labels } from '../locales/portal.js';
import { maxMessageLength, maxSubjectLength } from '../shared/jev.js';
import type { PortalDashboard, PortalDecision, PortalHistory, PortalUsage, PortalUser } from '../shared/portal.js';
import { InboxApi } from './InboxApi.js';
import './portal.css';

const home = (user: PortalUser) => user.role === 'admin' ? '/admin' : '/app';
const timestamp = (value: string) => new Date(value).toLocaleString();
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
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const authPage = path === '/login' || path === '/register';
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
      if (authPage || (path === '/admin' && account.role !== 'admin')) { window.location.replace(home(account)); return; }
      setUser(account); setReady(true);
    }).catch(cause => {
      if (controller.signal.aborted) return;
      if (status(cause) === 401) {
        if (authPage) setReady(true);
        else window.location.replace('/login');
      } else setError(errorText(cause));
    });
    return () => controller.abort();
  }, [path, authPage, attempt]);

  async function signOut() {
    try { await InboxApi.request('/auth/logout', 'POST'); window.location.replace('/login'); }
    catch (cause) { setError(errorText(cause)); }
  }
  if (!ready) return <main className="portal-loading">{error
    ? <div role="alert">{error} <button className="portal-secondary" onClick={() => setAttempt(n => n + 1)}>{en.retry}</button></div>
    : en.loading}</main>;
  if (!user) return <Login registering={path === '/register'} />;
  return <div className="portal-shell">
    <header className="portal-header"><Brand /><div className="portal-identity">
      <span>{user.email}<small>{user.role === 'admin' ? labels.admin : labels.user}</small></span>
      <button className="portal-secondary" onClick={() => void signOut()}>{labels.signOut}</button></div></header>
    <main className="portal-main"><nav className="portal-tabs" aria-label={labels.portal}>
      <a href="/app" aria-current={path === '/app' ? 'page' : undefined}>{labels.service}</a>
      {user.role === 'admin' && <a href="/admin" aria-current={path === '/admin' ? 'page' : undefined}>{labels.accounts}</a>}
      <a className="portal-inbox-link" href="/">{labels.publicInbox}</a>
    </nav>{error && <p className="portal-error" role="alert">{error}</p>}
      {path === '/admin' ? <AdminDashboard /> : <Classifier />}
    </main>
  </div>;
}

function Login({ registering }: { registering: boolean }) {
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
      window.location.replace(home(user));
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

function Classifier() {
  const [usage, setUsage] = useState<PortalUsage>();
  const [history, setHistory] = useState<PortalHistory[]>([]);
  const [result, setResult] = useState<PortalDecision>();
  const [error, setError] = useState('');
  const [readError, setReadError] = useState('');
  const [busy, setBusy] = useState(false);
  const [revision, refresh] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setReadError('');
    Promise.all([InboxApi.request<PortalUsage>('/usage/me', 'GET', undefined, controller.signal),
      InboxApi.request<{ results: PortalHistory[] }>('/classifications', 'GET', undefined, controller.signal)])
      .then(([summary, records]) => { if (!controller.signal.aborted) { setUsage(summary); setHistory(records.results); } })
      .catch(cause => { if (!controller.signal.aborted) setReadError(privateError(cause)); });
    return () => controller.abort();
  }, [revision]);
  async function classify(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true); setError(''); setResult(undefined);
    const fields = new FormData(event.currentTarget);
    try { setResult(await InboxApi.request<PortalDecision>('/classify', 'POST', { subject: fields.get('subject'), text: fields.get('text') })); }
    catch (cause) { setError(privateError(cause)); }
    finally { setBusy(false); refresh(n => n + 1); }
  }
  return <><h1 className="portal-intro">{labels.classifier}</h1>
    <div className="portal-content-grid"><section className="portal-card"><form className="portal-form" onSubmit={classify}>
      <label>{labels.subject}<input name="subject" maxLength={maxSubjectLength} required /></label>
      <label>{labels.message}<textarea name="text" maxLength={maxMessageLength} rows={7} required /></label>
      <button disabled={busy}>{busy ? labels.classifying : labels.classify}</button>
    </form>{error && <p className="portal-error" role="alert">{error}</p>}
      {result && <div className={`portal-result ${result.tier.toLowerCase()}`} role="status"><h2>{en.tiers[result.tier]}</h2>
        <p>{labels.result(result.score, result.model, result.durationMs)}</p></div>}
    </section><aside className="portal-card portal-usage"><h2>{labels.usage}</h2>
      {usage ? <><strong>{usage.requests}</strong><span>{labels.requests}</span><p>{labels.successful(usage.successful)}</p>
        <small>{usage.lastRequest ? labels.lastRequest(timestamp(usage.lastRequest)) : labels.noRequests}</small></> : !readError && en.loading}
      {readError && <div role="alert">{readError} <button className="portal-secondary" onClick={() => refresh(n => n + 1)}>{en.retry}</button></div>}
    </aside></div>
    <section className="portal-card portal-history"><h2>{labels.history}</h2>
      {history.length > 0 ? <div className="portal-table-wrap"><table><thead><tr>
        <th>{labels.priority}</th><th>{labels.score}</th><th>{labels.model}</th><th>{labels.time}</th></tr></thead>
        <tbody>{history.map(item => <tr key={item.id}><td>{en.tiers[item.tier]}</td><td>{item.score}</td><td>{item.model}</td><td>{timestamp(item.createdAt)}</td></tr>)}</tbody>
      </table></div> : usage && <p className="portal-muted">{labels.emptyHistory}</p>}
    </section></>;
}

function AdminDashboard() {
  const [data, setData] = useState<PortalDashboard>();
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setError('');
    InboxApi.request<PortalDashboard>('/admin/dashboard', 'GET', undefined, controller.signal)
      .then(list => { if (!controller.signal.aborted) setData(list); })
      .catch(cause => { if (!controller.signal.aborted) setError(privateError(cause)); });
    return () => controller.abort();
  }, [attempt]);
  return <section className="portal-card"><h1>{labels.accounts}</h1>
    {error && <p role="alert">{error} <button className="portal-secondary" onClick={() => setAttempt(n => n + 1)}>{en.retry}</button></p>}
    {data ? <div className="portal-table-wrap"><table><thead><tr><th>{labels.email}</th><th>{labels.role}</th>
      <th>{labels.joined}</th><th>{labels.requestCount}</th></tr></thead><tbody>{data.users.map(user => <tr key={user.id}>
        <td>{user.email}</td><td>{user.role === 'admin' ? labels.admin : labels.user}</td><td>{timestamp(user.createdAt)}</td><td>{user.requests}</td>
      </tr>)}</tbody></table></div> : !error && <p>{en.loading}</p>}
  </section>;
}
