/**
 * The household API client: JSON over fetch with a timeout, structured errors, and the If-Match revision header.
 * Nothing here touches the timing path; the player never waits on a request.
 */
declare global { interface Window { __openwodScope?: string } }

export class ApiError extends Error {
  constructor(readonly status: number, readonly code: string, message: string, readonly path?: string, readonly payload?: Record<string, unknown>) {
    super(message);
    this.name = 'ApiError';
  }
}
/** The server could not be reached at all (offline, down, or a proxy without a backend). */
export class NetworkError extends Error {
  constructor(message = 'The household server is not reachable.') { super(message); this.name = 'NetworkError'; }
}

export interface RequestOptions { body?: unknown; ifMatch?: number; timeoutMs?: number; signal?: AbortSignal }

export async function request<T>(method: 'GET' | 'PUT' | 'POST' | 'PATCH' | 'DELETE', path: string, { body, ifMatch, timeoutMs = 10_000, signal }: RequestOptions = {}): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  signal?.addEventListener('abort', () => controller.abort(), { once: true });
  const headers: Record<string, string> = { accept: 'application/json' };
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (ifMatch !== undefined) headers['if-match'] = `"${ifMatch}"`;
  if (__OPENWOD_TEST__ && window.__openwodScope) headers['x-openwod-scope'] = window.__openwodScope;
  let response: Response;
  try {
    response = await fetch(`/api/v1${path}`, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: controller.signal, cache: 'no-store' });
  } catch (error) {
    throw new NetworkError(error instanceof DOMException && error.name === 'AbortError' ? 'The household server did not answer in time.' : undefined);
  } finally { clearTimeout(timer); }
  const text = await response.text();
  let parsed: unknown = undefined;
  if (text) { try { parsed = JSON.parse(text); } catch { parsed = undefined; } }
  if (!response.ok) {
    const error = (parsed as { error?: { code?: string; message?: string; path?: string } } | undefined)?.error;
    if (response.status >= 500 && !error) throw new NetworkError(`The household server answered ${response.status}.`);
    throw new ApiError(response.status, error?.code ?? 'HTTP_ERROR', error?.message ?? `The server answered ${response.status}.`, error?.path, (error ?? parsed ?? {}) as Record<string, unknown>);
  }
  return parsed as T;
}

/** Downloads a server file through the browser: the API streams it, the page saves it. */
export function downloadUrl(path: string): string {
  return `/api/v1${path}`;
}
