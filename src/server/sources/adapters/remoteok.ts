import type { FetchContext, RawPosting, SearchQuery, SourceAdapter } from '../adapter';

/**
 * Remote OK public API (remote jobs only). One request returns the latest jobs as a JSON array; the first
 * element is a legal notice, not a job. No keyword parameter, so this adapter filters by search term on its
 * side. Remote OK asks API users to link back to the job URL and name Remote OK as the source.
 */

const API_URL = 'https://remoteok.com/api';

interface RemoteOkJob {
  id?: string | number | null;
  slug?: string | null;
  epoch?: number | null;
  date?: string | null;
  company?: string | null;
  position?: string | null;
  tags?: string[] | null;
  location?: string | null;
  apply_url?: string | null;
  url?: string | null;
  description?: string | null;
}

interface Entry {
  posting: RawPosting;
  keywords: string[];
}

/**
 * Some Remote OK text is UTF-8 that was decoded as Latin-1 and encoded again ("â\u0080\u0094" for "—").
 * C1 control characters (U+0080–U+009F) never occur in real text, so they mark such strings.
 */
export function repairMojibake(s: string): string {
  if (!/[\u0080-\u009f]/.test(s) || /[^\u0000-ÿ]/.test(s)) return s;
  const repaired = Buffer.from(s, 'latin1').toString('utf8');
  return repaired.includes('�') ? s : repaired;
}

function clean(s: string | null | undefined): string {
  return s ? repairMojibake(s).trim() : '';
}

function toIso(job: RemoteOkJob): string | null {
  if (typeof job.epoch === 'number' && job.epoch > 0) return new Date(job.epoch * 1000).toISOString();
  if (job.date) {
    const d = new Date(job.date);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  return null;
}

function entries(data: unknown): Entry[] {
  if (!Array.isArray(data)) throw new Error('Remote OK: response is not an array');
  const out: Entry[] = [];
  for (const item of data as RemoteOkJob[]) {
    // The legal-notice element has no position, so this check skips it too.
    const id = item?.id != null ? String(item.id).trim() : clean(item?.slug);
    const title = clean(item?.position);
    const company = clean(item?.company);
    const url = (item?.url || item?.apply_url || '').trim();
    if (!id || !title || !company || !url) continue;
    const location = clean(item.location);
    out.push({
      posting: {
        externalId: id,
        title,
        company,
        location: location ? `Remote — ${location}` : 'Remote',
        url,
        description: clean(item.description) || null,
        postedAt: toIso(item),
      },
      keywords: item.tags ?? [],
    });
  }
  return out;
}

export function parseRemoteOk(data: unknown): RawPosting[] {
  return entries(data).map((e) => e.posting);
}

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
  if (!res.ok) throw new Error(`Remote OK: HTTP ${res.status} for ${API_URL}`);
  for (const e of entries(await res.json())) {
    if (ctx.signal.aborted) return;
    if (matchesTerms(terms, e)) yield e.posting;
  }
}

export const remoteokAdapter: SourceAdapter = {
  id: 'remoteok',
  name: 'Remote OK',
  supports: { keywords: true, region: false },
  rate: { minDelayMs: 1000, maxConcurrent: 1 },
  search,
};
