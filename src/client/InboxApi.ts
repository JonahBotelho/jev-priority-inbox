// Same-origin browser client. Cookie sessions cover requests and EventSource.
export class InboxApi {
  static async request<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
    const response = await fetch(`/v1${path}`, { method, headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body) });
    if (!response.ok) {
      const result = await response.json();
      throw Object.assign(new Error(result.error), { status: response.status });
    }
    return response.status === 204 ? undefined as T : response.json();
  }
}
