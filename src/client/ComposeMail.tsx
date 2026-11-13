// Plain-text composer retains input and submission identity after transport failures.
import { useState } from 'react';
import type { ComposeInput, MailDetail, SendResult } from '../shared/mail.js';
import { en } from '../locales/en.js';
import { InboxApi } from './InboxApi.js';

export function ComposeMail({ reply, onClose }: { reply?: { id: string; message: MailDetail }; onClose: () => void }) {
  const [result, setResult] = useState<SendResult>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [submissionId, setSubmissionId] = useState(() => crypto.randomUUID());
  const labels = en.mail;
  const address = reply?.message.replyTo || reply?.message.from || '';
  const to = address.match(/[^\s<>@,]+@[^\s<>@,]+\.[^\s<>@,]+/g)?.join(', ') ?? '';
  const subject = reply ? (/^re:/i.test(reply.message.subject) ? reply.message.subject : labels.replyPrefix + reply.message.subject) : '';
  return <section className="compose-pane" aria-label={labels.compose}><h2>{reply ? labels.reply : labels.compose}</h2>
    <form onSubmit={event => {
      event.preventDefault(); const form = new FormData(event.currentTarget);
      const value = (name: string) => String(form.get(name) ?? '');
      const input: ComposeInput = { submissionId, to: value('to'), cc: value('cc'), bcc: value('bcc'),
        subject: value('subject'), text: value('text'), replyToId: reply?.id };
      setBusy(true); setError('');
      void InboxApi.request<SendResult>('/messages/send', 'POST', input).then(setResult)
        .catch(cause => setError(cause.message)).finally(() => setBusy(false));
    }}>
      <label>{labels.to}<input name="to" defaultValue={to} /></label>
      <label>{labels.cc}<input name="cc" /></label><label>{labels.bcc}<input name="bcc" /></label>
      <label>{labels.subject}<input name="subject" defaultValue={subject} readOnly={Boolean(reply)} maxLength={998}/></label>
      <label>{labels.body}<textarea name="text" rows={12} maxLength={100000} required /></label>
      <div className="mail-actions"><button disabled={busy || Boolean(result)}>{busy ? labels.sending : labels.send}</button>
        <button type="button" className="secondary" disabled={busy} onClick={onClose}>{labels.close}</button></div>
    </form>
    {result && <p role="status">{labels[result.status]} {result.rejected?.join(', ')}</p>}
    {result?.status === 'failed' && <button onClick={() => { setSubmissionId(crypto.randomUUID()); setResult(undefined); }}>{en.retry}</button>}
    {error && <p role="alert">{error}</p>}
  </section>;
}
