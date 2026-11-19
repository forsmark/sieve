import { extractJobText } from '../../ingestion/jobtext';
import { parse } from 'node-html-parser';
import type { FetchContext, RawPosting, SearchQuery, SourceAdapter } from '../adapter';

/**
 * Jobindex (jobindex.dk), a Danish-only job board.
 *
 * The search page embeds its results as JSON in a `var Stash = {...}` script. The region is a path
 * segment (`/jobsoegning/storkoebenhavn?q=...`); the old `area=` query parameter is ignored by the site.
 * When the region does not match a known Danish area, the search covers all of Denmark (no area segment).
 */

const BASE_URL = 'https://www.jobindex.dk/jobsoegning';
const MAX_PAGES = 2;

/** Free-text region -> Jobindex area path segment. Order matters: specific areas before broad ones. */
const AREA_SLUGS: Array<[RegExp, string]> = [
  [/copenhagen|k[øo]benhavn|koebenhavn|storkbh/i, 'storkoebenhavn'],
  [/north.?zealand|nords?j[æa]e?lland/i, 'nordsjaelland'],
  [/zealand|sj[æa]e?lland/i, 'sjaelland'],
  [/funen|fyn|odense/i, 'fyn'],
  [/north.?jutland|nordjylland|aalborg/i, 'region-nordjylland'],
  [/(mid|central).?jutland|midtjylland|aarhus|århus/i, 'region-midtjylland'],
  [/south.?jutland|sydjylland/i, 'sydjylland'],
  [/bornholm/i, 'bornholm'],
  [/abroad|udlandet/i, 'udlandet'],
];

export function jobindexAreaSlug(region: string): string | null {
  const r = region.trim();
  if (!r) return null;
  for (const [pattern, slug] of AREA_SLUGS) if (pattern.test(r)) return slug;
  return null;
}

export function buildJobindexUrl(term: string, region: string, page = 1): string {
  const slug = jobindexAreaSlug(region);
  const url = new URL(slug ? `${BASE_URL}/${slug}` : BASE_URL);
  url.searchParams.set('q', term);
  if (page > 1) url.searchParams.set('page', String(page));
  return url.toString();
}

interface StashResult {
  tid?: string | null;
  headline?: string | null;
  companytext?: string | null;
  area?: string | null;
  share_url?: string | null;
  firstdate?: string | null;
  html?: string | null;
}

interface SearchResponse {
  results?: StashResult[];
  total_pages?: number;
}

/** Extracts the `var Stash = {...}` object by brace balancing (strings in it may contain braces). */
function extractStash(html: string): Record<string, unknown> {
  const marker = 'var Stash = ';
  const start = html.indexOf(marker);
  if (start === -1) throw new Error('Jobindex: Stash object not found in page');
  const from = start + marker.length;
  let depth = 0;
  let inString = false;
  for (let i = from; i < html.length; i++) {
    const ch = html[i];
    if (inString) {
      if (ch === '\\') i++;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) {
      return JSON.parse(html.slice(from, i + 1)) as Record<string, unknown>;
    }
  }
  throw new Error('Jobindex: Stash object is not terminated');
}

function findSearchResponse(stash: Record<string, unknown>): SearchResponse {
  // The app key has been "jobsearch/result_app" and is now "jobsearch/result_app/list".
  for (const [key, value] of Object.entries(stash)) {
    if (!key.startsWith('jobsearch/result_app')) continue;
    const storeData = (value as { storeData?: { searchResponse?: SearchResponse } } | null)?.storeData;
    if (storeData?.searchResponse && Array.isArray(storeData.searchResponse.results)) return storeData.searchResponse;
  }
  throw new Error('Jobindex: searchResponse.results not found in Stash');
}

function toIso(date: string | null | undefined): string | null {
  if (!date) return null;
  const d = new Date(date);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** The result card HTML holds the teaser paragraphs between menus and buttons. Keep only the paragraphs. */
function teaser(cardHtml: string | null | undefined): string | null {
  if (!cardHtml) return null;
  const paragraphs = parse(cardHtml)
    .querySelectorAll('p')
    .filter((p) => p.text.trim().length > 0)
    .map((p) => p.outerHTML);
  return paragraphs.length > 0 ? paragraphs.join('\n') : null;
}

function toPosting(r: StashResult): RawPosting | null {
  const tid = r.tid?.trim();
  const title = r.headline?.trim();
  const company = r.companytext?.trim();
  if (!tid || !title || !company) return null;
  const url = r.share_url?.trim() || `https://www.jobindex.dk/vis-job/${tid}`;
  return {
    externalId: tid,
    title,
    company,
    location: r.area?.trim() || null,
    url,
    description: teaser(r.html),
    postedAt: toIso(r.firstdate),
  };
}

export function parseJobindexPage(html: string): { postings: RawPosting[]; totalPages: number } {
  const response = findSearchResponse(extractStash(html));
  const postings: RawPosting[] = [];
  for (const r of response.results ?? []) {
    const p = toPosting(r);
    if (p) postings.push(p);
  }
  return { postings, totalPages: typeof response.total_pages === 'number' ? response.total_pages : 1 };
}

export function parseJobindexHtml(html: string): RawPosting[] {
  return parseJobindexPage(html).postings;
}

async function* search(query: SearchQuery, ctx: FetchContext): AsyncGenerator<RawPosting> {
  const terms = query.terms.map((t) => t.trim()).filter(Boolean);
  const seen = new Set<string>();
  for (const term of terms) {
    for (let page = 1; page <= MAX_PAGES; page++) {
      if (ctx.signal.aborted) return;
      const url = buildJobindexUrl(term, query.region, page);
      const res = await ctx.http.get(url, {
        headers: { Accept: 'text/html,application/xhtml+xml', 'Accept-Language': 'da,en;q=0.9' },
      });
      if (!res.ok) throw new Error(`Jobindex: HTTP ${res.status} for ${url}`);
      const { postings, totalPages } = parseJobindexPage(await res.text());
      for (const p of postings) {
        if (ctx.signal.aborted) return;
        if (seen.has(p.externalId)) continue;
        seen.add(p.externalId);
        yield p;
      }
      if (postings.length === 0 || page >= totalPages) break;
    }
  }
}

const PAGE_HEADERS = { Accept: 'text/html,application/xhtml+xml', 'Accept-Language': 'da,en;q=0.9' };

/** The address behind the "Se jobbet" button of a Jobindex job page, or null when the page has none. */
export function parseJobindexTarget(html: string, pageUrl: string): string | null {
  const root = parse(html);
  const href = (root.querySelector('a.seejobdesktop') ?? root.querySelector('a.seejobmobil'))?.getAttribute('href')?.trim();
  if (!href) return null;
  try {
    const url = new URL(href.replace(/&amp;/g, '&'), pageUrl);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null;
  } catch {
    return null;
  }
}

/** The text of a job advertisement that Jobindex hosts at /jobannonce/. */
export function parseJobindexAd(html: string): string | null {
  const body = parse(html).querySelector('.jobtext-jobad__body');
  if (!body) return null;
  for (const junk of body.querySelectorAll('script, style, form, svg')) junk.remove();
  const inner = body.innerHTML.trim();
  return inner ? inner : null;
}

/** True when the page text names the job: a word of the title or the company. It rejects consent pages and error pages. */
function namesTheJob(text: string, posting: { title?: string; company?: string }): boolean {
  const words = `${posting.title ?? ''} ${posting.company ?? ''}`.toLowerCase().match(/[\p{L}\p{N}]{4,}/gu) ?? [];
  if (words.length === 0) return true;
  const lower = text.toLowerCase();
  return words.some((w) => lower.includes(w));
}

/** Removes the menu text before the job title, when the title stands in the first part of the page text. */
function fromTitle(text: string, title: string | undefined): string {
  const t = title?.trim();
  if (!t || t.length < 8) return text;
  const at = text.toLowerCase().indexOf(t.toLowerCase());
  return at > 0 && at < text.length * 0.4 && text.length - at >= 200 ? text.slice(at) : text;
}

/**
 * A search result holds only a teaser. The "Se jobbet" button of the job page leads to the full text:
 * an advertisement on Jobindex, or a page of the employer.
 */
async function fetchDescription(
  posting: { externalId: string; url: string; title?: string; company?: string },
  ctx: FetchContext,
): Promise<string | null> {
  const page = await ctx.http.get(posting.url, { headers: PAGE_HEADERS });
  if (!page.ok) return null;
  const target = parseJobindexTarget(await page.text(), posting.url);
  if (!target) return null;
  const res = await ctx.http.get(target, { headers: PAGE_HEADERS });
  if (!res.ok) return null;
  const html = await res.text();
  if (html.startsWith('%PDF')) return null;
  if (new URL(target).hostname.endsWith('jobindex.dk')) {
    const ad = parseJobindexAd(html);
    if (ad) return ad;
  }
  const text = extractJobText(html);
  return text && namesTheJob(text, posting) ? fromTitle(text, posting.title) : null;
}

export const jobindexAdapter: SourceAdapter = {
  id: 'jobindex',
  name: 'Jobindex',
  supports: { keywords: true, region: true },
  rate: { minDelayMs: 2000, maxConcurrent: 1 },
  search,
  fetchDescription,
  teaserOnly: true,
};
