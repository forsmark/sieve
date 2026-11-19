import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FetchContext, HttpResult, RawPosting } from '../adapter';
import { arbeitnowAdapter, parseArbeitnow } from './arbeitnow';

const fixture = readFileSync(new URL('./__fixtures__/arbeitnow.json', import.meta.url), 'utf8');

function fakeCtx(body: string, status = 200) {
  const urls: string[] = [];
  const get = vi.fn(async (url: string): Promise<HttpResult> => {
    urls.push(url);
    return { status, ok: status < 400, url, text: async () => body, json: async <T>() => JSON.parse(body) as T };
  });
  const ctx: FetchContext = { http: { get }, signal: new AbortController().signal, log: () => {} };
  return { ctx, get, urls };
}

async function collect(it: AsyncIterable<RawPosting>): Promise<RawPosting[]> {
  const out: RawPosting[] = [];
  for await (const p of it) out.push(p);
  return out;
}

afterEach(() => vi.restoreAllMocks());

describe('parseArbeitnow', () => {
  it('parses the recorded page', () => {
    const postings = parseArbeitnow(JSON.parse(fixture));
    expect(postings).toHaveLength(4);
    expect(postings[0]).toMatchObject({
      externalId: 'remote-full-stack-engineer-elevenapi-488657',
      title: 'Full-Stack Engineer - ElevenAPI',
      company: 'ElevenLabs',
      location: 'Remote',
      url: 'https://www.arbeitnow.com/jobs/companies/elevenlabs/remote-full-stack-engineer-elevenapi-488657',
      postedAt: new Date(1794379213 * 1000).toISOString(),
    });
    expect(postings[2]).toMatchObject({ company: 'Flexport', location: null });
  });

  it('decodes entity-escaped descriptions into HTML', () => {
    const flexport = parseArbeitnow(JSON.parse(fixture)).find((p) => p.company === 'Flexport')!;
    expect(flexport.description).toMatch(/^<div class="content-intro">/);
    expect(flexport.description).not.toContain('&lt;');
    expect(flexport.description).toContain('English Speaking Jobs in Germany');
  });

  it('skips an item without a title', () => {
    const data = JSON.parse(fixture);
    data.data[0].title = '';
    const postings = parseArbeitnow(data);
    expect(postings).toHaveLength(3);
    expect(postings.map((p) => p.externalId)).not.toContain('remote-full-stack-engineer-elevenapi-488657');
  });
});

describe('arbeitnowAdapter.search', () => {
  it('follows links.next through ctx.http up to the page limit and does not repeat postings', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const { ctx, urls } = fakeCtx(fixture);
    const postings = await collect(arbeitnowAdapter.search({ terms: [], region: '' }, ctx));
    expect(postings).toHaveLength(4);
    expect(urls).toEqual([
      'https://www.arbeitnow.com/api/job-board-api?page=1',
      'https://www.arbeitnow.com/api/job-board-api?page=2',
      'https://www.arbeitnow.com/api/job-board-api?page=2',
    ]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('keeps remote jobs and jobs in the region when a region is set', async () => {
    const { ctx } = fakeCtx(fixture);
    const postings = await collect(arbeitnowAdapter.search({ terms: [], region: 'Copenhagen' }, ctx));
    expect(postings.map((p) => p.company)).toEqual(['ElevenLabs', 'ElevenLabs']);
  });

  it('filters by term', async () => {
    const { ctx } = fakeCtx(fixture);
    const postings = await collect(arbeitnowAdapter.search({ terms: ['full-stack engineer'], region: '' }, ctx));
    const titles = postings.map((p) => p.title);
    expect(titles).toContain('Full-Stack Engineer - ElevenAPI');
    expect(titles).not.toContain('Account Executive, Enterprise');
    expect(titles).not.toContain('Principal Project Manager');
  });
});
