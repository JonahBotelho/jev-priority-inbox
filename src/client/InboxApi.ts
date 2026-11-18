// Cross-origin client. HttpOnly cookies authenticate requests to the API origin.
export class InboxApi {
  static readonly origin = (import.meta.env.VITE_API_URL ?? 'http://localhost:8000').replace(/\/$/, '');
  static url(path: string): string { return `${this.origin}/v1${path}`; }

  static async request<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
    const response = await fetch(this.url(path), { method, credentials: 'include', headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body) });
    if (!response.ok) {
      const result = await response.json();
      throw Object.assign(new Error(result.error), { status: response.status });
    }
    return response.status === 204 ? undefined as T : response.json();
  }
}
