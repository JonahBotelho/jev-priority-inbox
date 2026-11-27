// Displays server-tracked per-user API consumption and the 20 free calls exhausted warning.
import { portalText as labels } from '../locales/portal.js';
import type { ApiUsageQuota } from '../shared/portal.js';

export type UsageDisplay = ApiUsageQuota & { warning?: string | null };

export function UsageBanner({ usage }: { usage?: UsageDisplay }) {
  if (!usage) return null;
  const summary = usage.limitExceeded
    ? labels.usageExceededSummary(usage.requests, usage.freeLimit)
    : labels.usageSummary(usage.requests, usage.freeLimit);

  return <section className="portal-usage-wrap" aria-label={labels.usageLabel}>
    <div className="portal-usage-bar">
      <span className="portal-usage-label">{labels.usageLabel}</span>
      <span className={`portal-usage-count${usage.limitExceeded ? ' exceeded' : ''}`}>{summary}</span>
    </div>
    {usage.limitExceeded && (
      <p className="portal-warning" role="alert">{usage.warning || labels.freeLimitWarning}</p>
    )}
  </section>;
}
