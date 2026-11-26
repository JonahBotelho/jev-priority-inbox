// Private demo for a single typed email. The decision and history row appear together on inference.
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { en } from '../locales/en.js';
import { portalText as labels } from '../locales/portal.js';
import { maxMessageLength, maxSubjectLength } from '../shared/jev.js';
import { demoHistoryEntry, type DemoReceipt, type PortalHistory } from '../shared/portal.js';
import { historyFreshnessMs, observeDemoHistory } from './DemoHistoryRefresh.js';
import { DemoReceipts } from './DemoReceipts.js';
import { InboxApi } from './InboxApi.js';

type DisplayResult = PortalHistory & { receipt: DemoReceipt; totalMs: number };
type DescribeError = (error: unknown) => string;

function mergeHistory(current: PortalHistory[], incoming: PortalHistory[]) {
  const byId = new Map([...current, ...incoming].map(item => [item.id, item]));
  return [...byId.values()].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)
    || a.id.localeCompare(b.id)).slice(0, 50);
}

export function ClassifierDemo({ userId, describeError }: { userId: string; describeError: DescribeError }) {
  const [receipts] = useState(() => new DemoReceipts(userId));
  const [history, setHistory] = useState(() => receipts.history);
  const [historyRevision, setHistoryRevision] = useState(0);
  const lastApiUse = useRef(Date.now());
  const [result, setResult] = useState<DisplayResult>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const sync = useCallback(async () => setSaveError(!await receipts.sync()), [receipts]);

  const refreshHistory = useCallback(() => {
    lastApiUse.current = Date.now();
    setHistoryRevision(revision => revision + 1);
  }, []);
  const refreshIfStale = useCallback(() => {
    if (!document.hidden && Date.now() - lastApiUse.current >= historyFreshnessMs) refreshHistory();
  }, [refreshHistory]);

  useEffect(() => {
    const stopObserving = observeDemoHistory(document, refreshIfStale);
    window.addEventListener('focus', refreshIfStale);
    return () => {
      stopObserving();
      window.removeEventListener('focus', refreshIfStale);
    };
  }, [refreshIfStale]);

  useEffect(() => {
    void sync();
    window.addEventListener('online', sync);
    return () => window.removeEventListener('online', sync);
  }, [sync]);

  useEffect(() => {
    if (!saveError) return;
    const retry = window.setInterval(sync, 30000);
    return () => window.clearInterval(retry);
  }, [saveError, sync]);

  // Commit the decision and history row before touching browser storage or acknowledging the receipt.
  useEffect(() => {
    if (!result) return;
    receipts.add(result.receipt);
    void sync();
  }, [receipts, result, sync]);

  async function classify(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const started = performance.now();
    lastApiUse.current = Date.now();
    const fields = new FormData(event.currentTarget);
    setBusy(true);
    setError('');
    setResult(undefined);
    try {
      const receipt = await InboxApi.request<DemoReceipt>('/demo/inference', 'POST', {
        subject: fields.get('subject'), text: fields.get('text'),
      });
      if (receipt.inference.userId !== userId) { window.location.reload(); return; }
      const entry = demoHistoryEntry(receipt.inference);
      setResult({ ...entry, receipt, totalMs: Math.round(performance.now() - started) });
      setHistory(rows => mergeHistory(rows, [entry]));
    } catch (cause) {
      setError(describeError(cause));
    } finally {
      setBusy(false);
    }
  }

  return <>
    <h1 className="portal-intro">{labels.classifier}</h1>
    <p className="portal-muted portal-intro-help">{labels.demoHelp}</p>
    <div className="portal-content-grid">
      <form className="portal-card portal-form" onFocus={refreshIfStale} onChange={refreshIfStale} onSubmit={classify}>
        <label>{labels.subject}<input name="subject" maxLength={maxSubjectLength} required /></label>
        <label>{labels.message}<textarea name="text" maxLength={maxMessageLength} rows={7} required /></label>
        <button disabled={busy}>{busy ? labels.classifying : labels.classify}</button>
      </form>
      <section className="portal-card portal-decision" aria-labelledby="jev-decision">
        <h2 id="jev-decision">{labels.decision}</h2>
        <div className="portal-decision-body" role="status" aria-atomic="true">
          {error ? <p className="portal-error">{error}</p> : result ? <Decision result={result} />
            : <p className="portal-muted">{busy ? labels.awaitingJev : labels.awaitingInput}</p>}
        </div>
      </section>
    </div>
    <RecentClassifications localRows={history} describeError={describeError} revision={historyRevision} retry={refreshHistory} />
    {saveError && <p className="portal-error" role="alert">{labels.demoSaveError}{' '}
      <button className="portal-secondary" onClick={() => void sync()}>{labels.retrySave}</button>
    </p>}
  </>;
}

function Decision({ result }: { result: DisplayResult }) {
  return <>
    <strong className={`portal-tier ${result.tier.toLowerCase()}`}>{en.tiers[result.tier]}</strong>
    <dl>
      <div><dt>{labels.score}</dt><dd>{result.score}</dd></div>
      <div><dt>{labels.model}</dt><dd>{result.model}</dd></div>
      <div><dt>{labels.totalResponseTime}</dt><dd>{labels.milliseconds(result.totalMs)}</dd></div>
      <div><dt>{labels.responseTime}</dt><dd>{labels.milliseconds(result.receipt.inference.durationMs)}</dd></div>
    </dl>
  </>;
}

function RecentClassifications({ localRows, describeError, revision, retry }: {
  localRows: PortalHistory[]; describeError: DescribeError; revision: number; retry: () => void;
}) {
  const [savedRows, setSavedRows] = useState<PortalHistory[]>();
  const [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    setError('');
    InboxApi.request<{ results: PortalHistory[] }>('/classifications', 'GET', undefined, controller.signal)
      .then(page => { if (!controller.signal.aborted) setSavedRows(page.results); })
      .catch(cause => { if (!controller.signal.aborted) setError(describeError(cause)); });
    return () => controller.abort();
  }, [revision, describeError]);
  const rows = mergeHistory(savedRows ?? [], localRows);
  return <section className="portal-card portal-history" aria-labelledby="recent-classifications">
    <h2 id="recent-classifications">{labels.history}</h2>
    {error && <p role="alert">{error}{' '}
      <button className="portal-secondary" onClick={retry}>{en.retry}</button>
    </p>}
    {rows.length ? <div className="portal-table-wrap"><table>
      <thead><tr><th>{labels.priority}</th><th>{labels.score}</th><th>{labels.model}</th><th>{labels.time}</th></tr></thead>
      <tbody>{rows.map(item => <tr key={item.id}>
        <td><span className={`portal-tier ${item.tier.toLowerCase()}`}>{en.tiers[item.tier]}</span></td>
        <td>{item.score}</td><td>{item.model}</td>
        <td><time dateTime={item.createdAt}>{new Date(item.createdAt).toLocaleString()}</time></td>
      </tr>)}</tbody>
    </table></div> : !error && <p className="portal-muted">{savedRows ? labels.emptyHistory : en.loading}</p>}
  </section>;
}
