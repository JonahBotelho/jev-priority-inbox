// Server-side Express middleware that tracks normalized API endpoint request counts.
import type { NextFunction, Request, Response } from 'express';
import type { EndpointStat } from '../../shared/portal.js';
import type { PostgresPortal } from '../infrastructure/PostgresPortal.js';

type TrackedRoute = Omit<EndpointStat, 'requests'>;

const trackedMethods = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);
const excludedEndpoints = new Set([
  '/v1/health',
  '/v1/auth/register',
  '/v1/auth/login',
  '/v1/auth/logout',
  '/v1/auth/me',
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
    { method: 'GET', endpoint: '/v1/usage/me' },
  ];

  private readonly pending = new Set<Promise<void>>();

  constructor(private readonly store: Pick<PostgresPortal, 'recordEndpointHit'>) {}

  // Update the active router mount prefix while attaching at most one finish listener per request.
  track(prefix = '') {
    return (req: Request, res: Response, next: NextFunction) => {
      res.locals.endpointPrefix = prefix;
      if (!res.locals.endpointListenerAttached) {
        res.locals.endpointListenerAttached = true;
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

  async flush(): Promise<void> {
    // Drain in-flight telemetry writes before the admin dashboard reads totals.
    while (this.pending.size > 0) {
      await Promise.all([...this.pending]);
    }
  }

  private onFinish(req: Request, res: Response): void {
    const method = req.method.toUpperCase();
    const endpoint = this.resolveEndpoint(req, res);
    if (!endpoint || !this.shouldRecord(method, endpoint, res.statusCode)) return;

    const userId = typeof res.locals.user?.id === 'string' ? res.locals.user.id : undefined;
    const write = this.store.recordEndpointHit(method, endpoint, userId)
      .catch((error: unknown) => {
        const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : 'unknown';
        console.error(`Failed to record endpoint statistics (${method} ${endpoint}): ${code}`);
      })
      .finally(() => { this.pending.delete(write); });
    this.pending.add(write);
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
