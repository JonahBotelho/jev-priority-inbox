// Cross-origin client. HttpOnly cookies authenticate requests to the API origin.
import { en } from '../locales/en.js';
import type { ApiUsageQuota } from '../shared/portal.js';

type UsageListener = (quota: ApiUsageQuota) => void;

export class InboxApi {
  static readonly origin = (import.meta.env.VITE_API_URL ?? 'http://localhost:8000').replace(/\/$/, '');
  private static readonly usageListeners = new Set<UsageListener>();

  static url(path: string): string { return `${this.origin}/v1${path}`; }

  static onUsageChange(listener: UsageListener): () => void {
    this.usageListeners.add(listener);
    return () => { this.usageListeners.delete(listener); };
  }

  static async request<T>(path: string, method = 'GET', body?: unknown, signal?: AbortSignal): Promise<T> {
    const response = await fetch(this.url(path), { method, credentials: 'include', signal,
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body) });
    this.notifyUsage(response.headers);
    if (!response.ok) {
      const result = await response.json().catch(() => null);
      throw Object.assign(new Error(result?.error || en.unavailable), { status: response.status });
    }
    return response.status === 204 ? undefined as T : response.json();
  }

  private static notifyUsage(headers: Headers): void {
    const rawCount = headers.get('x-api-usage-count');
    const rawLimit = headers.get('x-api-free-limit');
    const rawExceeded = headers.get('x-api-limit-exceeded');
    if (rawCount === null || rawLimit === null || rawExceeded === null) return;
    const requests = Number(rawCount);
    const freeLimit = Number(rawLimit);
    if (!Number.isInteger(requests) || requests < 0 || !Number.isInteger(freeLimit) || freeLimit <= 0) return;
    if (rawExceeded !== 'true' && rawExceeded !== 'false') return;
    const quota: ApiUsageQuota = {
      requests,
      freeLimit,
      remainingFreeCalls: Math.max(0, freeLimit - requests),
      limitExceeded: rawExceeded === 'true',
    };
    for (const listener of this.usageListeners) listener(quota);
  }
}
