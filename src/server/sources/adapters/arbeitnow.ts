import type { FetchContext, RawPosting, SearchQuery, SourceAdapter } from '../adapter';

/**
 * Arbeitnow public job board API (mostly Germany, part remote). Pages of up to 300 jobs, newest first,
 * linked through `links.next`. The API has no keyword or location parameters, so this adapter filters on
 * its side: by search term, and by region (a job passes when it is remote or its location names the region).
 */

const API_URL = 'https://www.arbeitnow.com/api/job-board-api';
const MAX_PAGES = 3;

interface ArbeitnowJob {
  slug?: string | null;
  company_name?: string | null;
  title?: string | null;
  description?: string | null;
  remote?: boolean | null;
  url?: string | null;
  tags?: string[] | null;
  job_types?: string[] | null;
  location?: string | null;
  created_at?: number | null;
}

interface ArbeitnowResponse {
  data?: ArbeitnowJob[];
  links?: { next?: string | null };
}

interface Entry {
  posting: RawPosting;
  remote: boolean;
  keywords: string[];
}

/**
 * Some descriptions arrive entity-escaped ("&lt;div&gt;...") with a raw HTML footer appended by Arbeitnow.
 * Decode one level of escaping so the whole description is HTML.
 */
function normalizeDescription(desc: string | null | undefined): string | null {
  const d = desc?.trim();
  if (!d) return null;
  if (!d.startsWith('&lt;')) return d;
  return d
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&amp;/g, '&');
}

function formatLocation(location: string | null | undefined, remote: boolean): string | null {
  const loc = location?.trim();
  if (remote) return loc && loc.toLowerCase() !== 'remote' ? `${loc} (remote)` : 'Remote';
  return loc || null;
}

function entries(data: unknown): Entry[] {
  const jobs = (data as ArbeitnowResponse | null)?.data;
  if (!Array.isArray(jobs)) throw new Error('Arbeitnow: response has no data array');
  const out: Entry[] = [];
  for (const job of jobs) {
    const slug = job.slug?.trim();
    const title = job.title?.trim();
    const company = job.company_name?.trim();
    const url = job.url?.trim();
    if (!slug || !title || !company || !url) continue;
    const remote = job.remote === true;
    out.push({
      posting: {
        externalId: slug,
        title,
        company,
        location: formatLocation(job.location, remote),
        url,
        description: normalizeDescription(job.description),
        postedAt: typeof job.created_at === 'number' ? new Date(job.created_at * 1000).toISOString() : null,
      },
      remote,
      keywords: [...(job.tags ?? []), ...(job.job_types ?? [])],
    });
  }
  return out;
}

export function parseArbeitnow(data: unknown): RawPosting[] {
  return entries(data).map((e) => e.posting);
}

function nextPage(data: unknown): string | null {
  const next = (data as ArbeitnowResponse | null)?.links?.next;
  return typeof next === 'string' && next.startsWith(API_URL) ? next : null;
}

function matchesTerms(terms: string[], e: Entry): boolean {
  if (terms.length === 0) return true;
  const haystack = [e.posting.title, e.posting.description?.replace(/<[^>]+>/g, ' ') ?? '', ...e.keywords]
    .join(' ')
    .toLowerCase();
  return terms.some((term) => term.toLowerCase().split(/\s+/).every((word) => haystack.includes(word)));
}

function matchesRegion(region: string, e: Entry): boolean {
  const r = region.trim().toLowerCase();
  if (!r || e.remote) return true;
  return (e.posting.location ?? '').toLowerCase().includes(r);
}

async function* search(query: SearchQuery, ctx: FetchContext): AsyncGenerator<RawPosting> {
  const terms = query.terms.map((t) => t.trim()).filter(Boolean);
  const seen = new Set<string>();
  let url: string | null = `${API_URL}?page=1`;
  for (let page = 0; url && page < MAX_PAGES; page++) {
    if (ctx.signal.aborted) return;
    const res = await ctx.http.get(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`Arbeitnow: HTTP ${res.status} for ${url}`);
    const data = await res.json();
    for (const e of entries(data)) {
      if (ctx.signal.aborted) return;
      if (seen.has(e.posting.externalId)) continue;
      seen.add(e.posting.externalId);
      if (matchesTerms(terms, e) && matchesRegion(query.region, e)) yield e.posting;
    }
    url = nextPage(data);
  }
}

export const arbeitnowAdapter: SourceAdapter = {
  id: 'arbeitnow',
  name: 'Arbeitnow',
  supports: { keywords: true, region: true },
  rate: { minDelayMs: 1000, maxConcurrent: 1 },
  search,
};
