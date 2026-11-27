// Saved classification history table with inline priority update (PUT) and soft-delete (DELETE).
import { useEffect, useRef, useState } from 'react';
import { en } from '../locales/en.js';
import { portalText as labels } from '../locales/portal.js';
import { validTiers, type PortalHistory } from '../shared/portal.js';
import type { Tier } from '../shared/types.js';
import { InboxApi } from './InboxApi.js';

type DescribeError = (error: unknown) => string;

interface RecentClassificationsProps {
  localRows: PortalHistory[];
  initialSavedRows?: PortalHistory[];
  onSavedRowsChange?: (rows: PortalHistory[]) => void;
  onInvalidateCache?: () => void;
  describeError: DescribeError;
  revision: number;
  retry: () => void;
  ensureSynced: (id: string) => Promise<void>;
  onUpdate: (updated: PortalHistory) => void;
  onDelete: (id: string) => void;
  getHistorySeq: () => number;
  onHistoryLoaded: (startedSeq: number) => void;
  onHistoryReadStateChange: (inFlight: boolean) => void;
  onMutated: () => void;
}

export function mergeClassificationHistory(current: PortalHistory[], incoming: PortalHistory[]): PortalHistory[] {
  const byId = new Map([...current, ...incoming].map(item => [item.id, item]));
  return [...byId.values()].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)
    || a.id.localeCompare(b.id)).slice(0, 50);
}

export function RecentClassifications({
  localRows, initialSavedRows, onSavedRowsChange, onInvalidateCache, describeError, revision, retry,
  ensureSynced, onUpdate, onDelete, getHistorySeq, onHistoryLoaded, onHistoryReadStateChange, onMutated,
}: RecentClassificationsProps) {
  const [savedRows, setSavedRows] = useState<PortalHistory[] | undefined>(() => initialSavedRows);
  const [hadInitialCache] = useState(() => initialSavedRows !== undefined);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [actionError, setActionError] = useState('');
  const [notice, setNotice] = useState('');
  const [editingId, setEditingId] = useState<string>();
  const [draftTier, setDraftTier] = useState<Tier>('Routine');
  const [busyId, setBusyId] = useState<string>();
  const [busyAction, setBusyAction] = useState<'save' | 'delete'>();
  const activeReadRef = useRef<AbortController | null>(null);
  const readGenerationRef = useRef(0);

  function invalidateInFlightRead() {
    readGenerationRef.current += 1;
    activeReadRef.current?.abort();
    activeReadRef.current = null;
  }

  useEffect(() => {
    if (revision === 0 && hadInitialCache) return;
    const generation = ++readGenerationRef.current;
    const startedSeq = getHistorySeq();
    const controller = new AbortController();
    activeReadRef.current = controller;
    setLoading(true);
    onHistoryReadStateChange(true);
    setError('');
    InboxApi.request<{ results: PortalHistory[] }>('/classifications', 'GET', undefined, controller.signal)
      .then(page => {
        if (controller.signal.aborted || generation !== readGenerationRef.current) return;
        setSavedRows(page.results);
        onSavedRowsChange?.(page.results);
        onHistoryLoaded(startedSeq);
      })
      .catch(cause => {
        if (controller.signal.aborted || generation !== readGenerationRef.current) return;
        setError(describeError(cause));
      })
      .finally(() => {
        if (activeReadRef.current === controller) activeReadRef.current = null;
        if (generation === readGenerationRef.current) {
          setLoading(false);
          onHistoryReadStateChange(false);
        }
      });
    return () => {
      controller.abort();
      if (activeReadRef.current === controller) activeReadRef.current = null;
    };
  }, [revision, hadInitialCache, describeError, getHistorySeq, onHistoryLoaded, onHistoryReadStateChange, onSavedRowsChange]);

  function startEdit(item: PortalHistory) {
    setActionError('');
    setNotice('');
    setEditingId(item.id);
    setDraftTier(item.tier);
  }

  function cancelEdit() {
    setEditingId(undefined);
    setActionError('');
  }

  async function saveEdit(id: string) {
    if (busyId) return;
    setBusyId(id);
    setBusyAction('save');
    setActionError('');
    setNotice('');
    try {
      await ensureSynced(id);
      const updated = await InboxApi.request<PortalHistory>(`/classifications/${id}`, 'PUT', { tier: draftTier });
      invalidateInFlightRead();
      onInvalidateCache?.();
      setSavedRows(current => current?.map(item => item.id === id ? updated : item) ?? [updated]);
      onUpdate(updated);
      setEditingId(undefined);
      setNotice(labels.classificationUpdated);
      onMutated();
    } catch (cause) {
      setActionError(describeError(cause));
    } finally {
      setBusyId(undefined);
      setBusyAction(undefined);
    }
  }

  async function removeRow(id: string) {
    if (busyId) return;
    setBusyId(id);
    setBusyAction('delete');
    setActionError('');
    setNotice('');
    try {
      await ensureSynced(id);
      await InboxApi.request(`/classifications/${id}`, 'DELETE');
      invalidateInFlightRead();
      onInvalidateCache?.();
      setSavedRows(current => current?.filter(item => item.id !== id));
      onDelete(id);
      if (editingId === id) setEditingId(undefined);
      setNotice(labels.classificationDeleted);
      onMutated();
    } catch (cause) {
      setActionError(describeError(cause));
    } finally {
      setBusyId(undefined);
      setBusyAction(undefined);
    }
  }

  const rows = mergeClassificationHistory(savedRows ?? [], localRows);

  return <section className="portal-card portal-history" aria-labelledby="recent-classifications">
    <div className="portal-section-header">
      <h2 id="recent-classifications">{labels.history}</h2>
      <button type="button" className="portal-secondary" disabled={loading} onClick={retry}>
        {loading && savedRows ? labels.refreshing : labels.refresh}
      </button>
    </div>
    {error && <p role="alert">{error}{' '}
      <button type="button" className="portal-secondary" onClick={retry}>{en.retry}</button>
    </p>}
    {actionError && <p className="portal-error" role="alert">{actionError}</p>}
    {notice && <p className="portal-notice" aria-live="polite">{notice}</p>}
    {rows.length ? <div className="portal-table-wrap"><table>
      <thead><tr>
        <th>{labels.priority}</th>
        <th>{labels.score}</th>
        <th>{labels.model}</th>
        <th>{labels.time}</th>
        <th className="portal-actions-col">{labels.actions}</th>
      </tr></thead>
      <tbody>{rows.map(item => {
        const isEditing = editingId === item.id;
        const isRowBusy = busyId === item.id;
        return <tr key={item.id}>
          <td>{isEditing ? (
            <select className="portal-inline-select" aria-label={labels.priority}
              value={draftTier} disabled={isRowBusy} onChange={event => setDraftTier(event.target.value as Tier)}>
              {validTiers.map(tier => <option key={tier} value={tier}>{en.tiers[tier]}</option>)}
            </select>
          ) : (
            <span className={`portal-tier ${item.tier.toLowerCase()}`}>{en.tiers[item.tier]}</span>
          )}</td>
          <td>{item.score}</td>
          <td>{item.model}</td>
          <td><time dateTime={item.createdAt}>{new Date(item.createdAt).toLocaleString()}</time></td>
          <td className="portal-actions-col"><div className="portal-row-actions">{isEditing ? <>
            <button type="button" className="portal-action-button portal-action-primary" disabled={Boolean(busyId)}
              onClick={() => void saveEdit(item.id)}>
              {isRowBusy && busyAction === 'save' ? labels.saving : labels.save}
            </button>
            <button type="button" className="portal-action-button" disabled={Boolean(busyId)} onClick={cancelEdit}>
              {labels.cancel}
            </button>
          </> : <>
            <button type="button" className="portal-action-button" disabled={Boolean(busyId)}
              onClick={() => startEdit(item)}>
              {labels.edit}
            </button>
            <button type="button" className="portal-action-button portal-action-danger" disabled={Boolean(busyId)}
              onClick={() => void removeRow(item.id)}>
              {isRowBusy && busyAction === 'delete' ? labels.deleting : labels.delete}
            </button>
          </>}</div></td>
        </tr>;
      })}</tbody>
    </table></div> : !error && <p className="portal-muted">{savedRows ? labels.emptyHistory : en.loading}</p>}
  </section>;
}
