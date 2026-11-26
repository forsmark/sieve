import { parse } from 'node-html-parser';
import type { FetchContext, RawPosting, SearchQuery, SourceAdapter } from '../adapter';

/**
 * LinkedIn guest jobs API. No login. The search endpoint returns HTML job cards (currently 10 per page),
 * and the posting endpoint returns the HTML of one job with its full description.
 */

const SEARCH_URL = 'https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search';
const POSTING_URL = 'https://www.linkedin.com/jobs-guest/jobs/api/jobPosting';
const MAX_PAGES = 3;
const HEADERS = { Accept: 'text/html,application/xhtml+xml', 'Accept-Language': 'en-US,en;q=0.9' };

export function buildLinkedInSearchUrl(term: string, region: string, start = 0): string {
  const url = new URL(SEARCH_URL);
  url.searchParams.set('keywords', term);
  if (region.trim()) url.searchParams.set('location', region.trim());
  url.searchParams.set('f_TPR', 'r604800'); // posted in the last 7 days
  url.searchParams.set('start', String(start));
  return url.toString();
}

function toIso(date: string | null | undefined): string | null {
  if (!date) return null;
  const d = new Date(date);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** Drops tracking parameters, so the same job keeps the same URL across fetches. */
function cleanUrl(href: string): string | null {
  try {
    const u = new URL(href);
    u.search = '';
    u.hash = '';
    return u.toString();
  } catch {
    return null;
  }
}

/** Parses one search page. `cardCount` counts all cards, including skipped ones, for pagination. */
export function parseLinkedInSearchPage(html: string): { postings: RawPosting[]; cardCount: number } {
  const root = parse(html);
  const cards = root.querySelectorAll('[data-entity-urn]');
  const postings: RawPosting[] = [];
  let cardCount = 0;
  for (const card of cards) {
    const id = /urn:li:jobPosting:(\d+)/.exec(card.getAttribute('data-entity-urn') ?? '')?.[1];
    if (!id) continue;
    cardCount++;
    const title = card.querySelector('.base-search-card__title')?.text.trim();
    const company = card.querySelector('.base-search-card__subtitle')?.text.trim();
    const location = card.querySelector('.job-search-card__location')?.text.trim() || null;
    // Some cards are themselves the link; most hold an <a class="base-card__full-link">.
    const href = card.tagName === 'A' ? card.getAttribute('href') : card.querySelector('a.base-card__full-link')?.getAttribute('href');
    const url = href ? cleanUrl(href) : null;
    if (!title || !company || !url) continue;
    postings.push({
      externalId: id,
      title,
      company,
      location,
      url,
      description: null,
      postedAt: toIso(card.querySelector('time')?.getAttribute('datetime')),
    });
  }
  return { postings, cardCount };
}

export function parseLinkedInSearch(html: string): RawPosting[] {
  return parseLinkedInSearchPage(html).postings;
}

/** Returns the description HTML of a guest job-posting page, or null when it has none. */
export function parseLinkedInDescription(html: string): string | null {
  const root = parse(html);
  const el = root.querySelector('.show-more-less-html__markup') ?? root.querySelector('.description__text--rich');
  const inner = el?.innerHTML.trim();
  return inner ? inner : null;
}

async function* search(query: SearchQuery, ctx: FetchContext): AsyncGenerator<RawPosting> {
  const terms = query.terms.map((t) => t.trim()).filter(Boolean);
  const seen = new Set<string>();
  for (const term of terms) {
    let start = 0;
    for (let page = 0; page < MAX_PAGES; page++) {
      if (ctx.signal.aborted) return;
      const url = buildLinkedInSearchUrl(term, query.region, start);
      const res = await ctx.http.get(url, { headers: HEADERS });
      if (!res.ok) throw new Error(`LinkedIn: HTTP ${res.status} for ${url}`);
      const { postings, cardCount } = parseLinkedInSearchPage(await res.text());
      for (const p of postings) {
        if (ctx.signal.aborted) return;
        if (seen.has(p.externalId)) continue;
        seen.add(p.externalId);
        yield p;
      }
      if (cardCount === 0) break;
      start += cardCount;
    }
  }
}

async function fetchDescription(posting: { externalId: string; url: string }, ctx: FetchContext): Promise<string | null> {
  const url = `${POSTING_URL}/${encodeURIComponent(posting.externalId)}`;
  const res = await ctx.http.get(url, { headers: HEADERS });
  if (!res.ok) throw new Error(`LinkedIn: HTTP ${res.status} for ${url}`);
  return parseLinkedInDescription(await res.text());
}

export const linkedinAdapter: SourceAdapter = {
  id: 'linkedin',
  name: 'LinkedIn',
  supports: { keywords: true, region: true },
  rate: { minDelayMs: 4000, maxConcurrent: 1 },
  search,
  fetchDescription,
};
