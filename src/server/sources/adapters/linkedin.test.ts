import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FetchContext, HttpResult, RawPosting } from '../adapter';
import { linkedinAdapter, parseLinkedInDescription, parseLinkedInSearch } from './linkedin';

const searchFixture = readFileSync(new URL('./__fixtures__/linkedin-search.html', import.meta.url), 'utf8');
const postingFixture = readFileSync(new URL('./__fixtures__/linkedin-posting.html', import.meta.url), 'utf8');

function fakeCtx(body: (url: string) => string, status = 200, signal = new AbortController().signal) {
  const urls: string[] = [];
  const get = vi.fn(async (url: string): Promise<HttpResult> => {
    urls.push(url);
    const text = body(url);
    return { status, ok: status < 400, url, text: async () => text, json: async <T>() => JSON.parse(text) as T };
  });
  const ctx: FetchContext = { http: { get }, signal, log: () => {} };
  return { ctx, get, urls };
}

async function collect(it: AsyncIterable<RawPosting>): Promise<RawPosting[]> {
  const out: RawPosting[] = [];
  for await (const p of it) out.push(p);
  return out;
}

afterEach(() => vi.restoreAllMocks());

describe('parseLinkedInSearch', () => {
  it('parses the job cards', () => {
    const postings = parseLinkedInSearch(searchFixture);
    expect(postings).toHaveLength(4);
    expect(postings[0]).toEqual({
      externalId: '4488435682',
      title: 'Software Engineer(Product Backend)',
      company: 'Teton',
      location: 'Copenhagen, Capital Region of Denmark, Denmark',
      url: 'https://dk.linkedin.com/jobs/view/software-engineer-product-backend-at-teton-4488435682',
      description: null,
      postedAt: '2026-11-06T00:00:00.000Z',
    });
  });

  it('skips a card without a title', () => {
    const html = searchFixture.replace(
      /<h3 class="base-search-card__title">[\s\S]*?Software Engineer\(Product Backend\)[\s\S]*?<\/h3>/,
      '<h3 class="base-search-card__title"></h3>',
    );
    const postings = parseLinkedInSearch(html);
    expect(postings).toHaveLength(3);
    expect(postings.map((p) => p.externalId)).not.toContain('4488435682');
  });
});

describe('parseLinkedInDescription', () => {
  it('returns the description HTML of a posting page', () => {
    const description = parseLinkedInDescription(postingFixture);
    expect(description).toContain('Teton is redefining the role of healthcare workers');
    expect(description).toMatch(/</);
  });

  it('returns null when the page has no description', () => {
    expect(parseLinkedInDescription('<html><body></body></html>')).toBeNull();
  });
});

describe('linkedinAdapter.search', () => {
  it('pages through at most 3 pages per term via ctx.http and passes the region as location', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const { ctx, urls } = fakeCtx(() => searchFixture);
    const postings = await collect(linkedinAdapter.search({ terms: ['developer'], region: 'Aarhus' }, ctx));
    expect(postings).toHaveLength(4); // the same page three times; repeats are dropped
    expect(urls).toHaveLength(3);
    const parsed = urls.map((u) => new URL(u));
    expect(parsed.map((u) => u.searchParams.get('start'))).toEqual(['0', '4', '8']);
    expect(parsed[0]!.searchParams.get('keywords')).toBe('developer');
    expect(parsed[0]!.searchParams.get('location')).toBe('Aarhus');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('stops paging when a page has no cards', async () => {
    const { ctx, urls } = fakeCtx((url) => (new URL(url).searchParams.get('start') === '0' ? searchFixture : ''));
    const postings = await collect(linkedinAdapter.search({ terms: ['developer'], region: '' }, ctx));
    expect(postings).toHaveLength(4);
    expect(urls).toHaveLength(2);
    expect(new URL(urls[0]!).searchParams.has('location')).toBe(false);
  });

  it('makes no request when there are no terms', async () => {
    const { ctx, get } = fakeCtx(() => searchFixture);
    expect(await collect(linkedinAdapter.search({ terms: [], region: 'Denmark' }, ctx))).toEqual([]);
    expect(get).not.toHaveBeenCalled();
  });

  it('stops when the signal is aborted', async () => {
    const controller = new AbortController();
    const { ctx } = fakeCtx(() => searchFixture, 200, controller.signal);
    const seen: RawPosting[] = [];
    for await (const p of linkedinAdapter.search({ terms: ['developer'], region: '' }, ctx)) {
      seen.push(p);
      controller.abort();
    }
    expect(seen).toHaveLength(1);
  });

  it('throws with the status when the response is not ok', async () => {
    const { ctx } = fakeCtx(() => '', 429);
    await expect(collect(linkedinAdapter.search({ terms: ['x'], region: '' }, ctx))).rejects.toThrow(/429/);
  });
});

describe('linkedinAdapter.fetchDescription', () => {
  it('reads the guest job-posting endpoint through ctx.http', async () => {
    const { ctx, urls } = fakeCtx(() => postingFixture);
    const description = await linkedinAdapter.fetchDescription!(
      { externalId: '4488435682', url: 'https://dk.linkedin.com/jobs/view/x-4488435682' },
      ctx,
    );
    expect(urls).toEqual(['https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/4488435682']);
    expect(description).toContain('Teton is redefining');
  });
});
