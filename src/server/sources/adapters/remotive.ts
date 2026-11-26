import type { FetchContext, RawPosting, SearchQuery, SourceAdapter } from '../adapter';

/**
 * Remotive public API (remote jobs only). One request returns the whole public feed. The API currently
 * ignores its `category`, `search`, and `limit` parameters, so this adapter fetches the feed once and filters
 * by search term on its side. Remotive asks clients to fetch at most a few times a day.
 */

const API_URL = 'https://remotive.com/api/remote-jobs';

interface RemotiveJob {
  id?: number | string | null;
  url?: string | null;
  title?: string | null;
  company_name?: string | null;
  category?: string | null;
  tags?: string[] | null;
  publication_date?: string | null;
  candidate_required_location?: string | null;
  description?: string | null;
}

interface RemotiveResponse {
  jobs?: RemotiveJob[];
}

interface Entry {
  posting: RawPosting;
  keywords: string[];
}

/** Remotive dates have no time zone ("2026-10-17T16:04:29"). They are UTC. */
function toIso(date: string | null | undefined): string | null {
  if (!date) return null;
  const hasZone = /(Z|[+-]\d{2}:?\d{2})$/i.test(date);
  const d = new Date(hasZone || !date.includes('T') ? date : `${date}Z`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function formatLocation(candidateLocation: string | null | undefined): string {
  const loc = candidateLocation?.trim();
  return !loc || loc.toLowerCase() === 'worldwide' ? 'Remote' : `Remote — ${loc}`;
}

function entries(data: unknown): Entry[] {
  const jobs = (data as RemotiveResponse | null)?.jobs;
  if (!Array.isArray(jobs)) throw new Error('Remotive: response has no jobs array');
  const out: Entry[] = [];
  for (const job of jobs) {
    const id = job.id != null ? String(job.id).trim() : '';
    const title = job.title?.trim();
    const company = job.company_name?.trim();
    const url = job.url?.trim();
    if (!id || !title || !company || !url) continue;
    out.push({
      posting: {
        externalId: id,
        title,
        company,
        location: formatLocation(job.candidate_required_location),
        url,
        description: job.description?.trim() || null,
        postedAt: toIso(job.publication_date),
      },
      keywords: [...(job.tags ?? []), job.category ?? ''],
    });
  }
  return out;
}

export function parseRemotive(data: unknown): RawPosting[] {
  return entries(data).map((e) => e.posting);
}

/** True when every word of at least one term occurs in the title, tags, or description. */
function matchesTerms(terms: string[], e: Entry): boolean {
  if (terms.length === 0) return true;
  const haystack = [e.posting.title, e.posting.description?.replace(/<[^>]+>/g, ' ') ?? '', ...e.keywords].join(' ').toLowerCase();
  return terms.some((term) =>
    term
      .toLowerCase()
      .split(/\s+/)
      .every((word) => haystack.includes(word)),
  );
}

async function* search(query: SearchQuery, ctx: FetchContext): AsyncGenerator<RawPosting> {
  if (ctx.signal.aborted) return;
  const terms = query.terms.map((t) => t.trim()).filter(Boolean);
  const res = await ctx.http.get(API_URL, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`Remotive: HTTP ${res.status} for ${API_URL}`);
  for (const e of entries(await res.json())) {
    if (ctx.signal.aborted) return;
    if (matchesTerms(terms, e)) yield e.posting;
  }
}

export const remotiveAdapter: SourceAdapter = {
  id: 'remotive',
  name: 'Remotive',
  supports: { keywords: true, region: false },
  rate: { minDelayMs: 1000, maxConcurrent: 1 },
  search,
};
