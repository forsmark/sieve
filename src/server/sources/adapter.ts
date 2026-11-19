/**
 * The contract that every job source implements.
 *
 * Rules for an adapter:
 * - It never sleeps. The rate limit is data, and `ctx.http` applies it.
 * - It never writes to the database. It yields raw postings, and the fetch runner stores them.
 * - It yields each posting as soon as it has it, so a timeout keeps the earlier postings.
 * - It passes `ctx.signal` on, or uses `ctx.http`, which already does.
 */

export interface SearchQuery {
  /** Search terms from the user. Empty when the user saved none. */
  terms: string[];
  /** Free-text target region, for example "Copenhagen" or "Denmark". May be empty. */
  region: string;
}

export interface RawPosting {
  /** Identifier of the posting on the source. Stable across fetches. */
  externalId: string;
  title: string;
  company: string;
  location?: string | null;
  url: string;
  /** Plain text or HTML. Ingestion removes markup. */
  description?: string | null;
  /** ISO 8601 date, or null when the source gives none. */
  postedAt?: string | null;
}

export interface HttpRequestOptions {
  headers?: Record<string, string>;
  /** Time limit for one attempt in milliseconds. Default 20000. */
  timeoutMs?: number;
}

export interface HttpResult {
  status: number;
  ok: boolean;
  url: string;
  text(): Promise<string>;
  json<T = unknown>(): Promise<T>;
}

/** HTTP client that applies the adapter's rate limit, retries 429 and 5xx with backoff, and has a timeout. */
export interface RateLimitedClient {
  get(url: string, opts?: HttpRequestOptions): Promise<HttpResult>;
}

export interface FetchContext {
  http: RateLimitedClient;
  signal: AbortSignal;
  log(message: string): void;
}

export interface SourceAdapter {
  /** Stable identifier, lower case, for example "jobindex". */
  id: string;
  /** Display name, for example "Jobindex". */
  name: string;
  /** Which search inputs the source uses. The interface shows this to the user. */
  supports: { keywords: boolean; region: boolean };
  rate: { minDelayMs: number; maxConcurrent: number };
  search(query: SearchQuery, ctx: FetchContext): AsyncIterable<RawPosting>;
  /** Optional second request for a full description. The enrich task calls it. */
  fetchDescription?(posting: { externalId: string; url: string; title?: string; company?: string }, ctx: FetchContext): Promise<string | null>;
  /**
   * True when a search result holds only a teaser of the job text. The enrich task then fetches the
   * full description for each posting, also when the teaser is long.
   */
  teaserOnly?: boolean;
}
