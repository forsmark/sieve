import { sqlite } from '../kernel/db';
import { nowIso, isoAfter } from '../kernel/clock';
import { publish } from '../kernel/events';
import { enqueue, registerHandler } from '../kernel/tasks';
import type { FetchContext, RateLimitedClient } from '../sources/adapter';
import { createRateLimitedClient } from '../sources/http';
import { getAdapter } from '../sources/registry';
import { MIN_DESCRIPTION_LENGTH, priorityFor } from './ingest';
import { htmlToText } from './normalize';
import { extractJobText } from './jobtext';

export { extractJobText };

type ClientFactory = (rate: { minDelayMs: number; maxConcurrent: number }, signal: AbortSignal) => RateLimitedClient;
let clientFactory: ClientFactory = (rate, signal) => createRateLimitedClient(rate, signal);

export function setEnrichClientForTests(factory: ClientFactory | null): void {
  clientFactory = factory ?? ((rate, signal) => createRateLimitedClient(rate, signal));
}

interface EnrichRow {
  id: string;
  source: string;
  external_id: string;
  url: string;
  title: string;
  company: string;
  description: string | null;
  posted_at: string | null;
  first_seen_at: string;
  duplicate_of: string | null;
}

async function fetchDescription(posting: EnrichRow): Promise<string | null> {
  const adapter = getAdapter(posting.source);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('enrichment timed out')), 45_000);
  try {
    const ctx: FetchContext = {
      http: clientFactory(adapter?.rate ?? { minDelayMs: 500, maxConcurrent: 1 }, controller.signal),
      signal: controller.signal,
      log: () => {},
    };
    if (adapter?.fetchDescription) {
      const text = await adapter.fetchDescription({ externalId: posting.external_id, url: posting.url, title: posting.title, company: posting.company }, ctx);
      if (text) {
        const clean = htmlToText(text);
        if (clean.length >= MIN_DESCRIPTION_LENGTH) return clean;
      }
    }
    // The page of a teaser source lists other jobs too, so its text is not the text of this job.
    if (adapter?.teaserOnly) return null;
    const res = await ctx.http.get(posting.url);
    if (!res.ok) return null;
    return extractJobText(await res.text());
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Puts the text of the source before the fetched text, unless the fetched text already starts with it. */
export function mergeDescription(existing: string | null, fetched: string): string {
  const teaser = existing?.trim() ?? '';
  if (teaser.length < 40) return fetched;
  const squash = (s: string) => s.replace(/\s+/g, ' ').toLowerCase();
  if (squash(fetched).includes(squash(teaser).slice(0, 80))) return fetched;
  return `${teaser}\n\n${fetched}`.slice(0, 24_000);
}

export function registerEnrichHandler(): void {
  registerHandler('enrich', async (ctx) => {
    const posting = sqlite
      .prepare('SELECT id, source, external_id, url, title, company, description, posted_at, first_seen_at, duplicate_of FROM postings WHERE id = ?')
      .get(ctx.subjectId) as EnrichRow | undefined;
    if (!posting || posting.duplicate_of) return;
    const text = await fetchDescription(posting);
    const now = nowIso();
    if (text) {
      sqlite
        .prepare('UPDATE postings SET description = ?, lacks_description = 0, enriched_at = ? WHERE id = ?')
        .run(mergeDescription(posting.description, text), now, posting.id);
    } else {
      // A teaser of the source still counts as a description. Without one, the posting is scored from
      // title, company, and location, with a low-confidence flag.
      const hasText = (posting.description?.length ?? 0) >= MIN_DESCRIPTION_LENGTH;
      sqlite.prepare('UPDATE postings SET lacks_description = ?, enriched_at = ? WHERE id = ?').run(hasText ? 0 : 1, now, posting.id);
    }
    publish({ type: 'posting.updated', postingId: posting.id });
    const manual = (ctx.payload as { manual?: boolean } | undefined)?.manual === true;
    enqueue('extract', posting.id, {
      priority: priorityFor(posting.posted_at, posting.first_seen_at) + (manual ? 1_000_000_000 : 0),
      ...(manual ? { payload: { manual: true } } : {}),
    });
  });
}

// ---- Link liveness

export type Liveness = 'active' | 'expired' | 'unknown';

const EXPIRY_SIGNALS = ['expired', 'closed', 'no-longer', 'not-available', 'position-filled', 'job-not-found'];

type FetchLike = typeof fetch;
let livenessFetch: FetchLike = (...a) => fetch(...a);

export function setLivenessFetchForTests(f: FetchLike | null): void {
  livenessFetch = f ?? ((...a) => fetch(...a));
}

/** Classifies a link. Only proof of removal gives "expired". Every other problem gives "unknown". */
export async function classifyLiveness(url: string): Promise<Liveness> {
  try {
    const request = (method: 'HEAD' | 'GET') =>
      livenessFetch(url, {
        method,
        redirect: 'follow',
        signal: AbortSignal.timeout(10_000),
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; link-check/1.0)' },
      });
    let res = await request('HEAD');
    // Some sites do not accept HEAD. A GET gives the real status.
    if (res.status === 405 || res.status === 501) {
      res = await request('GET');
      await res.body?.cancel().catch(() => {});
    }
    if (res.status === 404 || res.status === 410) return 'expired';
    if (res.status >= 400) return 'unknown';
    const finalUrl = (res.url || url).toLowerCase();
    if (finalUrl !== url.toLowerCase() && EXPIRY_SIGNALS.some((s) => finalUrl.includes(s))) return 'expired';
    return 'active';
  } catch {
    return 'unknown';
  }
}

const DAY = 86_400_000;
export const LIVENESS_MIN_AGE_DAYS = 3;
export const LIVENESS_INTERVAL_DAYS = 7;
export const LIVENESS_UNKNOWN_RETRY_DAYS = 1;

export function registerLivenessHandler(): void {
  registerHandler('liveness', async (ctx) => {
    const posting = sqlite.prepare('SELECT id, url FROM postings WHERE id = ?').get(ctx.subjectId) as { id: string; url: string } | undefined;
    if (!posting) return;
    const status = await classifyLiveness(posting.url);
    sqlite.prepare('UPDATE postings SET link_status = ?, link_checked_at = ? WHERE id = ?').run(status, nowIso(), posting.id);
    publish({ type: 'posting.updated', postingId: posting.id });
  });
}

/** Queues link checks for untriaged and saved postings whose last check is old. Returns the number of queued checks. */
export function queueLivenessChecks(limit = 20): number {
  const rows = sqlite
    .prepare(
      `SELECT id FROM postings
       WHERE triage_status IN ('new', 'saved') AND duplicate_of IS NULL AND link_status != 'expired'
         AND first_seen_at < ?
         AND (link_checked_at IS NULL
              OR (link_status = 'unknown' AND link_checked_at < ?)
              OR link_checked_at < ?)
       ORDER BY link_checked_at ASC LIMIT ?`,
    )
    .all(isoAfter(-LIVENESS_MIN_AGE_DAYS * DAY), isoAfter(-LIVENESS_UNKNOWN_RETRY_DAYS * DAY), isoAfter(-LIVENESS_INTERVAL_DAYS * DAY), limit) as Array<{
    id: string;
  }>;
  let queued = 0;
  for (const r of rows) if (enqueue('liveness', r.id, { priority: -1 })) queued++;
  return queued;
}
