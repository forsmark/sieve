/** Low-level fetch helper. Every endpoint function in `endpoints.ts` goes through `request`. */

export class ApiRequestError extends Error {
  readonly status: number;
  readonly body: unknown;
  constructor(status: number, message: string, body: unknown) {
    super(message);
    this.name = 'ApiRequestError';
    this.status = status;
    this.body = body;
  }
}

type UnauthorizedHandler = () => void;
let onUnauthorized: UnauthorizedHandler | null = null;

/** The app registers a handler that shows the login screen when a request returns 401. */
export function setUnauthorizedHandler(handler: UnauthorizedHandler | null): void {
  onUnauthorized = handler;
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  /** A plain object becomes JSON. FormData is sent as multipart. */
  body?: unknown;
  signal?: AbortSignal;
  /** Return the body of these error statuses instead of throwing. */
  acceptStatus?: number[];
}

export function toQueryString(params: Record<string, string | number | boolean | undefined | null>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '' || v === false) continue;
    sp.set(k, v === true ? '1' : String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : '';
}

/** Joins the path prefix the client was built for with an absolute path such as `/api/status`. */
export function joinBase(base: string, path: string): string {
  return base.replace(/\/+$/, '') + path;
}

/** The URL of an API path under the prefix of this build. Without `APP_BASE` the prefix is `/`. */
export function apiPath(path: string): string {
  return joinBase(import.meta.env.BASE_URL, path);
}

export async function request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  let body: BodyInit | undefined;
  if (opts.body instanceof FormData) {
    body = opts.body;
  } else if (opts.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(opts.body);
  }
  let res: Response;
  try {
    res = await fetch(apiPath(path), { method: opts.method ?? 'GET', headers, body, signal: opts.signal, credentials: 'same-origin' });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    throw new ApiRequestError(0, 'The server cannot be reached. Check that it is running.', null);
  }
  const text = await res.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }
  if (res.ok || opts.acceptStatus?.includes(res.status)) return data as T;
  if (res.status === 401 && path !== '/api/auth/login') onUnauthorized?.();
  const message =
    data && typeof data === 'object' && 'error' in data && typeof (data as { error: unknown }).error === 'string'
      ? (data as { error: string }).error
      : `The request failed with status ${res.status}.`;
  throw new ApiRequestError(res.status, message, data);
}

export function errorText(err: unknown): string {
  if (err instanceof Error) return err.message;
  return 'Something went wrong.';
}
