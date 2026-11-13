// Centered account chooser with manual server configuration on a separate screen.
import { useState } from 'react';
import { en } from '../locales/en.js';
import { InboxApi } from './InboxApi.js';
import './login.css';

export function ConnectMailbox({ google, onConnected }: { google: boolean; onConnected: () => void }) {
  const [manual, setManual] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [separate, setSeparate] = useState(false);
  const labels = en.mail;
  const brand = <a className="connection-brand" href="/" aria-label={en.title}>
    {en.brand}<span>{en.brandSubtitle}</span>
  </a>;

  if (!manual) return <div className="connection-page">
    {brand}
    <main className="connection-center">
      <section className="connection-card" aria-labelledby="connect-heading">
        <h1 id="connect-heading">{labels.connectHeading}</h1>
        {google ? <a className="connection-google" href="/v1/connect/google">
          <span className="google-mark" aria-hidden="true">G</span>{labels.google}
        </a> : <button className="connection-google" onClick={() => setError(labels.googleUnavailable)}>
          <span className="google-mark" aria-hidden="true">G</span>{labels.google}
        </button>}
        <div className="connection-divider" />
        <button className="connection-other" onClick={() => { setError(''); setManual(true); }}>
          {labels.anotherAccount}<span aria-hidden="true">→</span>
        </button>
        <a className="connection-demo" href="/demo">{labels.viewDemo}<span aria-hidden="true">→</span></a>
        <p className="connection-demo-hint">{labels.demoHint}</p>
        {error && <p className="connection-error" role="alert">{error}</p>}
      </section>
    </main>
  </div>;

  return <div className="connection-page">
    {brand}
    <main className="manual-connection">
      <button className="text-button" onClick={() => { setManual(false); setError(''); }} disabled={busy}>
        <span aria-hidden="true">← </span>{labels.backToOptions}
      </button>
      <h1>{labels.manual}</h1>
      <form onSubmit={event => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        const value = (name: string) => String(form.get(name) ?? '');
        const imap = { host: value('imapHost'), port: Number(value('imapPort')), user: value('imapUser'), password: value('imapPassword') };
        const smtp = { host: value('smtpHost'), port: Number(value('smtpPort')),
          user: separate ? value('smtpUser') : imap.user, password: separate ? value('smtpPassword') : imap.password };
        setBusy(true); setError('');
        void InboxApi.request('/connect/manual', 'POST', { email: value('email'), imap, smtp })
          .then(onConnected).catch(cause => setError(cause.message)).finally(() => setBusy(false));
      }}>
        <label>{labels.email}<input name="email" type="email" autoComplete="email" required /></label>
        <fieldset><legend>{labels.incoming}</legend>
          <label>{labels.imapHost}<input name="imapHost" required /></label>
          <label>{labels.port}<input name="imapPort" type="number" defaultValue="993" min="1" max="65535" required /></label>
          <label>{labels.user}<input name="imapUser" autoComplete="username" required /></label>
          <label>{labels.password}<input name="imapPassword" type="password" autoComplete="current-password" required /></label>
        </fieldset>
        <fieldset><legend>{labels.outgoing}</legend>
          <label>{labels.smtpHost}<input name="smtpHost" required /></label>
          <label>{labels.port}<select name="smtpPort" defaultValue="587"><option>587</option><option>465</option></select></label>
          <label className="checkbox-label"><input type="checkbox" checked={separate} onChange={event => setSeparate(event.target.checked)} />{labels.separate}</label>
          {separate && <><label>{labels.user}<input name="smtpUser" required /></label>
            <label>{labels.password}<input name="smtpPassword" type="password" required /></label></>}
        </fieldset>
        <button disabled={busy}>{busy ? en.loading : labels.connect}</button>
      </form>
      {error && <p role="alert">{error}</p>}
    </main>
  </div>;
}
