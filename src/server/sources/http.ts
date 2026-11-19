import type { HttpRequestOptions, HttpResult, RateLimitedClient } from './adapter';

export interface HttpClientDeps {
  fetch: typeof fetch;
  sleep(ms: number, signal?: AbortSignal): Promise<void>;
  now(): number;
}

const realSleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason ?? new Error('aborted'));
    const t = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      reject(signal!.reason ?? new Error('aborted'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });

export const realHttpDeps: HttpClientDeps = { fetch: (...a) => fetch(...a), sleep: realSleep, now: () => Date.now() };

const USER_AGENT = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const MAX_RETRIES = 3;
const BACKOFF_BASE_MS = 2000;
const MAX_BACKOFF_MS = 60_000;

/**
 * Creates the HTTP client for one source.
 * - At most `maxConcurrent` requests run at the same time.
 * - Two requests start at least `minDelayMs` apart.
 * - HTTP 429 and 5xx cause a retry after a backoff. A Retry-After header sets the wait.
 * - After a 429, all later requests of this client wait for the same backoff.
 */
export function createRateLimitedClient(
  rate: { minDelayMs: number; maxConcurrent: number },
  signal: AbortSignal,
  deps: HttpClientDeps = realHttpDeps,
): RateLimitedClient {
  let active = 0;
  let nextStartAt = 0;
  const waiting: Array<() => void> = [];

  async function acquire(): Promise<void> {
    if (active >= Math.max(1, rate.maxConcurrent)) {
      await new Promise<void>((resolve) => waiting.push(resolve));
    }
    active++;
    const startAt = Math.max(deps.now(), nextStartAt);
    nextStartAt = startAt + rate.minDelayMs;
    const wait = startAt - deps.now();
    if (wait > 0) await deps.sleep(wait, signal);
  }

  function release(): void {
    active--;
    waiting.shift()?.();
  }

  function retryDelay(res: Response, attempt: number): number {
    const header = res.headers.get('retry-after');
    if (header) {
      const seconds = Number(header);
      if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, MAX_BACKOFF_MS);
    }
    return Math.min(BACKOFF_BASE_MS * 2 ** attempt, MAX_BACKOFF_MS);
  }

  async function get(url: string, opts: HttpRequestOptions = {}): Promise<HttpResult> {
    for (let attempt = 0; ; attempt++) {
      if (signal.aborted) throw signal.reason ?? new Error('aborted');
      await acquire();
      let res: Response;
      try {
        res = await deps.fetch(url, {
          headers: { 'User-Agent': USER_AGENT, Accept: '*/*', ...opts.headers },
          redirect: 'follow',
          signal: AbortSignal.any([signal, AbortSignal.timeout(opts.timeoutMs ?? 20_000)]),
        });
      } finally {
        release();
      }
      const retryable = res.status === 429 || res.status >= 500;
      if (retryable && attempt < MAX_RETRIES) {
        const delay = retryDelay(res, attempt);
        // Later requests of this source wait too. Other sources have their own client.
        nextStartAt = Math.max(nextStartAt, deps.now() + delay);
        await res.body?.cancel().catch(() => {});
        continue;
      }
      return {
        status: res.status,
        ok: res.ok,
        url: res.url || url,
        text: () => res.text(),
        json: <T>() => res.json() as Promise<T>,
      };
    }
  }

  return { get };
}
