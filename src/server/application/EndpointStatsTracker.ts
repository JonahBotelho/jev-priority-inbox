// Server-side Express middleware that tracks normalized API endpoint request counts and committed usage headers.
import type { NextFunction, Request, Response } from 'express';
import { buildUsageQuota, type EndpointStat } from '../../shared/portal.js';

type TrackedRoute = Omit<EndpointStat, 'requests'>;
export interface EndpointStatsStore {
  recordEndpointHit(method: string, endpoint: string, userId?: string): Promise<number | void | undefined>;
}

const trackedMethods = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);
const excludedEndpoints = new Set([
  '/v1/health',
  '/v1/auth/register',
  '/v1/auth/login',
  '/v1/auth/logout',
  '/v1/auth/me',
  '/v1/usage/me',
  '/v1/admin/dashboard',
]);

export class EndpointStatsTracker {
  static readonly trackedCatalog: readonly TrackedRoute[] = [
    { method: 'GET', endpoint: '/v1/priority' },
    { method: 'POST', endpoint: '/v1/inbound' },
    { method: 'POST', endpoint: '/v1/classify' },
    { method: 'POST', endpoint: '/v1/demo/inference' },
    { method: 'POST', endpoint: '/v1/demo/receipts' },
    { method: 'GET', endpoint: '/v1/classifications' },
    { method: 'PUT', endpoint: '/v1/classifications/:id' },
    { method: 'DELETE', endpoint: '/v1/classifications/:id' },
  ];

  private readonly pendingPublic = new Set<Promise<unknown>>();
  private readonly pendingByUser = new Map<string, Set<Promise<unknown>>>();

  constructor(private readonly store: EndpointStatsStore) {}

  // Update the active router mount prefix while attaching at most one response hook per request.
  track(prefix = '') {
    return (req: Request, res: Response, next: NextFunction) => {
      res.locals.endpointPrefix = prefix;
      if (!res.locals.endpointListenerAttached) {
        res.locals.endpointListenerAttached = true;
        this.interceptResponse(req, res);
        res.on('finish', () => this.onFinish(req, res));
      }
      next();
    };
  }

  mergeWithCatalog(stored: EndpointStat[]): EndpointStat[] {
    const merged = new Map<string, EndpointStat>();
    for (const item of EndpointStatsTracker.trackedCatalog) {
      merged.set(`${item.method} ${item.endpoint}`, { ...item, requests: 0 });
    }
    for (const row of stored) {
      merged.set(`${row.method} ${row.endpoint}`, row);
    }
    return [...merged.values()].sort(
      (a, b) => b.requests - a.requests || a.endpoint.localeCompare(b.endpoint) || a.method.localeCompare(b.method),
    );
  }

  async flushUser(userId: string): Promise<void> {
    // Wait only for this caller's already-started writes so unrelated traffic cannot stall quota reads.
    const pending = this.pendingByUser.get(userId);
    if (!pending?.size) return;
    await Promise.all([...pending]);
  }

  async flush(): Promise<void> {
    // Drain all in-flight telemetry writes before the admin dashboard reads global totals.
    while (this.pendingPublic.size > 0 || this.pendingByUser.size > 0) {
      const batch: Promise<unknown>[] = [...this.pendingPublic];
      for (const userWrites of this.pendingByUser.values()) batch.push(...userWrites);
      await Promise.all(batch);
    }
  }

  private interceptResponse(req: Request, res: Response): void {
    const originalEnd = res.end.bind(res);
    res.end = ((...args: unknown[]) => {
      if (res.headersSent || res.locals.endpointEndHandled) {
        return (originalEnd as (...params: unknown[]) => Response)(...args);
      }
      res.locals.endpointEndHandled = true;
      const userId = typeof res.locals.user?.id === 'string' ? res.locals.user.id : undefined;
      const method = req.method.toUpperCase();
      const endpoint = this.resolveEndpoint(req, res);
      const shouldCount = Boolean(endpoint && this.shouldRecord(method, endpoint, res.statusCode));

      if (!userId || !shouldCount) {
        if (userId && typeof res.locals.apiRequests === 'number') {
          this.setUsageHeaders(res, res.locals.apiRequests);
        }
        return (originalEnd as (...params: unknown[]) => Response)(...args);
      }

      // Commit authenticated usage before sending headers so concurrent requests emit committed totals.
      res.locals.endpointRecorded = true;
      void this.trackWrite(method, endpoint!, userId).then(committedTotal => {
        if (!res.headersSent && !res.destroyed) {
          const reportedTotal = typeof committedTotal === 'number' ? committedTotal : res.locals.apiRequests;
          if (typeof reportedTotal === 'number') this.setUsageHeaders(res, reportedTotal);
        }
        if (!res.writableEnded) (originalEnd as (...params: unknown[]) => Response)(...args);
      });
      return res;
    }) as Response['end'];
  }

  private onFinish(req: Request, res: Response): void {
    if (res.locals.endpointRecorded) return;
    const method = req.method.toUpperCase();
    const endpoint = this.resolveEndpoint(req, res);
    if (!endpoint || !this.shouldRecord(method, endpoint, res.statusCode)) return;

    const userId = typeof res.locals.user?.id === 'string' ? res.locals.user.id : undefined;
    void this.trackWrite(method, endpoint, userId);
  }

  private trackWrite(method: string, endpoint: string, userId?: string): Promise<number | undefined> {
    const bucket = userId ? this.userBucket(userId) : this.pendingPublic;
    const write = this.store.recordEndpointHit(method, endpoint, userId)
      .then(total => typeof total === 'number' ? total : undefined)
      .catch((error: unknown) => {
        const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : 'unknown';
        console.error(`Failed to record endpoint statistics (${method} ${endpoint}): ${code}`);
        return undefined;
      })
      .finally(() => {
        bucket.delete(write);
        if (userId && bucket.size === 0) this.pendingByUser.delete(userId);
      });
    bucket.add(write);
    return write;
  }

  private userBucket(userId: string): Set<Promise<unknown>> {
    let bucket = this.pendingByUser.get(userId);
    if (!bucket) {
      bucket = new Set();
      this.pendingByUser.set(userId, bucket);
    }
    return bucket;
  }

  private setUsageHeaders(res: Response, requests: number): void {
    const quota = buildUsageQuota(requests);
    res.setHeader('X-API-Usage-Count', String(quota.requests));
    res.setHeader('X-API-Free-Limit', String(quota.freeLimit));
    res.setHeader('X-API-Limit-Exceeded', String(quota.limitExceeded));
  }

  private resolveEndpoint(req: Request, res: Response): string | undefined {
    const routePath = req.route?.path;
    if (typeof routePath !== 'string') return undefined;
    const prefix = typeof res.locals.endpointPrefix === 'string' ? res.locals.endpointPrefix : '';
    const combined = `${prefix}${routePath}`;
    return combined.length > 1 ? combined.replace(/\/+$/, '') : combined;
  }

  private shouldRecord(method: string, endpoint: string, statusCode: number): boolean {
    if (!trackedMethods.has(method)) return false;
    if (statusCode === 401 || statusCode === 403) return false;
    if (excludedEndpoints.has(endpoint)) return false;
    if (endpoint === '/doc' || endpoint.startsWith('/doc/')) return false;
    return true;
  }
}
