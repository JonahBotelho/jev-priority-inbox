// Registration, the Jev classification client, personal usage, and the administrator dashboard.
import { useEffect, useState, type FormEvent } from 'react';
import { InboxApi } from './InboxApi.js';
import { en } from '../locales/en.js';
import './portal.css';

interface User { id: string; email: string; role: 'user' | 'admin' }
interface Usage { requests: number; successful: number; lastRequest: string | null }
interface Dashboard { users: Array<{ id: string; email: string; role: string; createdAt: string; requests: number }>;
  totals: { requests: number; successful: number | null }; recent: Array<{ email: string; endpoint: string; status: number; durationMs: number; createdAt: string }> }
interface Result { tier: string; score: number; provider: string; model: string; durationMs: number }
interface ClassificationRecord { id: string; tier: string; score: number; model: string; createdAt: string }

export function Portal() {
  const [user, setUser] = useState<User>();
  const [loading, setLoading] = useState(true);
  const [registering, setRegistering] = useState(false);
  const [view, setView] = useState<'service' | 'admin'>('service');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [usage, setUsage] = useState<Usage>();
  const [dashboard, setDashboard] = useState<Dashboard>();
  const [result, setResult] = useState<Result>();
  const [history, setHistory] = useState<ClassificationRecord[]>([]);

  useEffect(() => {
    void InboxApi.request<User>('/auth/me')
      .then(account => { setUser(account); setView(account.role === 'admin' ? 'admin' : 'service'); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!user) return;
    if (view === 'admin' && user.role === 'admin') void InboxApi.request<Dashboard>('/admin/dashboard').then(setDashboard).catch(cause => setError((cause as Error).message));
    else void Promise.all([InboxApi.request<Usage>('/usage/me'), InboxApi.request<{ results: ClassificationRecord[] }>('/classifications')])
      .then(([summary, records]) => { setUsage(summary); setHistory(records.results); })
      .catch(cause => setError((cause as Error).message));
  }, [user, view]);

  async function submitAuth(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError('');
    const fields = new FormData(event.currentTarget);
    try {
      const signedIn = await InboxApi.request<User>(registering ? '/auth/register' : '/auth/login', 'POST', {
        email: fields.get('email'), password: fields.get('password'),
      });
      setUser(signedIn);
      setView(signedIn.role === 'admin' ? 'admin' : 'service');
    } catch (cause) { setError((cause as Error).message); }
    finally { setBusy(false); }
  }

  async function classify(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(''); setResult(undefined);
    const fields = new FormData(event.currentTarget);
    try {
      const response = await InboxApi.request<Result>('/classify', 'POST', {
        subject: fields.get('subject'), text: fields.get('text'),
      });
      setResult(response);
      const [summary, records] = await Promise.all([InboxApi.request<Usage>('/usage/me'),
        InboxApi.request<{ results: ClassificationRecord[] }>('/classifications')]);
      setUsage(summary); setHistory(records.results);
    } catch (cause) { setError((cause as Error).message); }
    finally { setBusy(false); }
  }

  async function signOut() {
    await InboxApi.request('/auth/logout', 'POST'); setUser(undefined); setDashboard(undefined); setUsage(undefined); setView('service');
  }

  if (loading) return <main className="portal-loading">{en.loading}</main>;
  if (!user) return <main className="portal-auth-page">
    <a className="portal-brand" href="/">Jev <span>Priority Inbox</span></a>
    <section className="portal-card">
      <p className="portal-eyebrow">AI PRIORITY CLASSIFICATION</p>
      <h1>{registering ? 'Create your account' : 'Sign in to Jev'}</h1>
      <p className="portal-muted">Classify an email’s urgency and review your API usage.</p>
      <form onSubmit={submitAuth} className="portal-form">
        <label>Email<input name="email" type="email" autoComplete="email" required /></label>
        <label>Password<input name="password" type="password" autoComplete={registering ? 'new-password' : 'current-password'} minLength={registering ? 3 : 1} required /></label>
        <button disabled={busy}>{busy ? 'Please wait…' : registering ? 'Create account' : 'Sign in'}</button>
      </form>
      {error && <p className="portal-error" role="alert">{error}</p>}
      <button className="portal-link-button" onClick={() => { setRegistering(!registering); setError(''); }}>
        {registering ? 'Already registered? Sign in' : 'Need an account? Register'}
      </button>
      <p className="portal-small">{en.passwordRequirement}</p>
    </section>
  </main>;

  return <div className="portal-shell">
    <header className="portal-header">
      <a className="portal-brand" href="/">Jev <span>Priority Inbox</span></a>
      <div className="portal-identity"><span>{user.email}<small>{user.role === 'admin' ? 'Administrator' : 'User'}</small></span>
        <button className="portal-secondary" onClick={() => void signOut()}>Sign out</button></div>
    </header>
    <main className="portal-main">
      <nav className="portal-tabs" aria-label="Application sections">
        <button className={view === 'service' ? 'active' : ''} onClick={() => setView('service')}>AI service</button>
        {user.role === 'admin' && <button className={view === 'admin' ? 'active' : ''} onClick={() => setView('admin')}>Administrator dashboard</button>}
        <a href="/demo">Try fictional inbox</a>
      </nav>
      {error && <p className="portal-error" role="alert">{error}</p>}
      {view === 'admin' && user.role === 'admin' ? <AdminDashboard data={dashboard} onChange={async () => {
        setDashboard(await InboxApi.request<Dashboard>('/admin/dashboard'));
      }} /> : <>
        <section className="portal-intro"><p className="portal-eyebrow">JEV AI SERVICE</p><h1>Email priority classifier</h1>
          <p>Submit an email subject and message. Jev estimates whether it calls for immediate action, near-term action, or routine handling.</p></section>
        <div className="portal-content-grid">
          <section className="portal-card"><h2>Classify an email</h2>
            <form className="portal-form" onSubmit={classify}>
              <label>Subject<input name="subject" maxLength={500} required placeholder="Production database is unavailable" /></label>
              <label>Message<textarea name="text" maxLength={10000} required rows={8} placeholder="Paste the message text here…" /></label>
              <button disabled={busy}>{busy ? 'Classifying…' : 'Classify priority'}</button>
            </form>
            {result && <div className={`portal-result ${result.tier.toLowerCase()}`} aria-live="polite">
              <p className="portal-eyebrow">RESULT</p><h3>{result.tier}</h3>
              <p>Priority score: {result.score} · {result.provider} {result.model} · {result.durationMs} ms</p>
            </div>}
          </section>
          <aside className="portal-card portal-usage"><h2>Your API usage</h2>
            <strong>{usage?.requests ?? 0}</strong><span>classification requests</span>
            <p>{usage?.successful ?? 0} successful</p>
            <small>{usage?.lastRequest ? `Last request: ${new Date(usage.lastRequest).toLocaleString()}` : 'No requests yet'}</small>
          </aside>
        </div>
        <section className="portal-card portal-history"><h2>Recent classifications</h2>
          {history.length ? <div className="portal-table-wrap"><table><thead><tr><th>Priority</th><th>Score</th><th>Model</th><th>Time</th></tr></thead>
            <tbody>{history.map(item => <tr key={item.id}><td>{item.tier}</td><td>{item.score}</td><td>{item.model}</td><td>{new Date(item.createdAt).toLocaleString()}</td></tr>)}</tbody></table></div>
            : <p className="portal-muted">Your results will appear here. Email text is not stored in this history.</p>}
        </section>
      </>}
    </main>
  </div>;
}

function AdminDashboard({ data, onChange }: { data?: Dashboard; onChange: () => Promise<void> }) {
  if (!data) return <p className="portal-muted">Loading dashboard…</p>;
  return <section className="portal-admin">
    <div className="portal-intro"><p className="portal-eyebrow">ADMINISTRATION</p><h1>Usage dashboard</h1>
      <p>Registered accounts and API activity. Administrator access is enforced by the API.</p></div>
    <div className="portal-stats"><article><strong>{data.users.length}</strong><span>registered users</span></article>
      <article><strong>{data.totals.requests ?? 0}</strong><span>API requests</span></article>
      <article><strong>{data.totals.successful ?? 0}</strong><span>successful requests</span></article></div>
    <section className="portal-card"><h2>Registered users</h2><div className="portal-table-wrap"><table><thead><tr><th>Email</th><th>Role</th><th>Joined</th><th>Requests</th><th>Actions</th></tr></thead>
      <tbody>{data.users.map(user => <tr key={user.id}><td>{user.email}</td><td><select value={user.role} aria-label={`Role for ${user.email}`}
        onChange={event => void InboxApi.request(`/admin/users/${user.id}`, 'PATCH', { role: event.target.value }).then(onChange).catch(cause => window.alert((cause as Error).message))}>
        <option value="user">user</option><option value="admin">admin</option></select></td><td>{new Date(user.createdAt).toLocaleDateString()}</td><td>{user.requests}</td>
        <td><button className="portal-delete" onClick={() => {
          if (window.confirm(`Delete ${user.email} and their usage history?`)) {
            void InboxApi.request(`/admin/users/${user.id}`, 'DELETE').then(onChange).catch(cause => window.alert((cause as Error).message));
          }
        }}>Delete</button></td></tr>)}</tbody></table></div>
    </section>
    <section className="portal-card"><h2>Recent API activity</h2><div className="portal-table-wrap"><table><thead><tr><th>User</th><th>Endpoint</th><th>Status</th><th>Duration</th><th>Time</th></tr></thead>
      <tbody>{data.recent.map((item, index) => <tr key={`${item.createdAt}-${index}`}><td>{item.email}</td><td>{item.endpoint}</td><td>{item.status}</td><td>{item.durationMs} ms</td><td>{new Date(item.createdAt).toLocaleString()}</td></tr>)}</tbody></table></div>
    </section>
  </section>;
}
