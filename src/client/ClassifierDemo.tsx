// Private demo for a single typed email. The decision and history row appear together on inference.
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { en } from '../locales/en.js';
import { portalText as labels } from '../locales/portal.js';
import { maxMessageLength, maxSubjectLength } from '../shared/jev.js';
import { demoHistoryEntry, type DemoReceipt, type PortalHistory } from '../shared/portal.js';
import { historyFreshnessMs, observeDemoHistory } from './DemoHistoryRefresh.js';
import { DemoReceipts } from './DemoReceipts.js';
import { InboxApi } from './InboxApi.js';
import { mergeClassificationHistory, RecentClassifications } from './RecentClassifications.js';

type DisplayResult = PortalHistory & { receipt: DemoReceipt; totalMs: number };
type DescribeError = (error: unknown) => string;

interface ClassifierDemoProps {
  userId: string;
  describeError: DescribeError;
  cachedSavedRows?: PortalHistory[];
  onCacheHistory?: (rows: PortalHistory[]) => void;
  onInvalidateHistoryCache?: () => void;
}

export function ClassifierDemo({
  userId, describeError, cachedSavedRows, onCacheHistory, onInvalidateHistoryCache,
}: ClassifierDemoProps) {
  const [receipts] = useState(() => new DemoReceipts(userId));
  const [history, setHistory] = useState(() => receipts.history);
  const [historyRevision, setHistoryRevision] = useState(0);
  const lastApiUse = useRef(Date.now());
  const ackSeq = useRef(0);
  const confirmedAtSeq = useRef(new Map<string, number>());
  const historyReadInFlight = useRef(false);
  const refreshAfterRead = useRef(false);
  const [result, setResult] = useState<DisplayResult>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState(false);

  const refreshHistory = useCallback(() => {
    lastApiUse.current = Date.now();
    refreshAfterRead.current = false;
    setHistoryRevision(revision => revision + 1);
  }, []);

  const sync = useCallback(async () => {
    const { ok, confirmedIds } = await receipts.sync();
    setSaveError(!ok);
    const newlyConfirmed = confirmedIds.filter(id => !confirmedAtSeq.current.has(id));
    if (!newlyConfirmed.length) return;
    const seq = ++ackSeq.current;
    for (const id of newlyConfirmed) confirmedAtSeq.current.set(id, seq);
    // Defer the post-acknowledge read if one is already in flight so active reads are not aborted.
    if (historyReadInFlight.current) refreshAfterRead.current = true;
    else refreshHistory();
  }, [receipts, refreshHistory]);

  const getHistorySeq = useCallback(() => ackSeq.current, []);

  const handleHistoryReadStateChange = useCallback((inFlight: boolean) => {
    historyReadInFlight.current = inFlight;
    if (!inFlight && refreshAfterRead.current) {
      refreshAfterRead.current = false;
      refreshHistory();
    }
  }, [refreshHistory]);

  const handleHistoryLoaded = useCallback((startedSeq: number) => {
    // Compute retired IDs outside the state updater so React StrictMode double-invocations stay pure.
    const retired = new Set<string>();
    for (const [id, ackedAt] of confirmedAtSeq.current) {
      if (ackedAt <= startedSeq && !receipts.has(id)) retired.add(id);
    }
    if (!retired.size) return;
    for (const id of retired) confirmedAtSeq.current.delete(id);
    setHistory(rows => {
      const remaining = rows.filter(item => !retired.has(item.id));
      return remaining.length === rows.length ? rows : remaining;
    });
  }, [receipts]);

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

  const ensureSynced = useCallback(async (id: string) => {
    if (receipts.has(id)) await sync();
  }, [receipts, sync]);

  const handleUpdate = useCallback((updated: PortalHistory) => {
    setHistory(rows => rows.some(item => item.id === updated.id)
      ? rows.map(item => item.id === updated.id ? updated : item)
      : rows);
  }, []);

  const handleDelete = useCallback((id: string) => {
    receipts.discard(id);
    confirmedAtSeq.current.delete(id);
    setHistory(rows => rows.filter(item => item.id !== id));
  }, [receipts]);

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
      onInvalidateHistoryCache?.();
      setResult({ ...entry, receipt, totalMs: Math.round(performance.now() - started) });
      setHistory(rows => mergeClassificationHistory(rows, [entry]));
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
    <RecentClassifications localRows={history} initialSavedRows={cachedSavedRows} onSavedRowsChange={onCacheHistory}
      onInvalidateCache={onInvalidateHistoryCache} describeError={describeError} revision={historyRevision}
      retry={refreshHistory} ensureSynced={ensureSynced} onUpdate={handleUpdate} onDelete={handleDelete}
      getHistorySeq={getHistorySeq} onHistoryLoaded={handleHistoryLoaded}
      onHistoryReadStateChange={handleHistoryReadStateChange} onMutated={refreshHistory} />
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
