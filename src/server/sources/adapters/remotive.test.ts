import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FetchContext, HttpResult, RawPosting } from '../adapter';
import { parseRemotive, remotiveAdapter } from './remotive';

const fixture = readFileSync(new URL('./__fixtures__/remotive.json', import.meta.url), 'utf8');

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

describe('parseRemotive', () => {
  it('parses the recorded feed', () => {
    const postings = parseRemotive(JSON.parse(fixture));
    expect(postings).toHaveLength(4);
    expect(postings[0]).toMatchObject({
      externalId: '2091158',
      title: 'Software Engineer, AI Coding Tasks',
      company: 'Askable',
      location: 'Remote',
      url: expect.stringContaining('remotive.com/remote-jobs/'),
      postedAt: '2026-10-17T16:04:29.000Z',
    });
    expect(postings[0]!.description).toMatch(/</);
    expect(postings[1]!.location).toMatch(/^Remote — Europe, USA/);
  });

  it('skips an item without a title', () => {
    const data = JSON.parse(fixture);
    data.jobs[0].title = '';
    const postings = parseRemotive(data);
    expect(postings).toHaveLength(3);
    expect(postings.map((p) => p.externalId)).not.toContain('2091158');
  });
});

describe('remotiveAdapter.search', () => {
  it('fetches once through ctx.http and yields all postings when there are no terms', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const { ctx, urls } = fakeCtx(fixture);
    const postings = await collect(remotiveAdapter.search({ terms: [], region: '' }, ctx));
    expect(postings).toHaveLength(4);
    expect(urls).toEqual(['https://remotive.com/api/remote-jobs']);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('filters by term on title, tags, and description', async () => {
    const { ctx } = fakeCtx(fixture);
    const postings = await collect(remotiveAdapter.search({ terms: ['rails'], region: '' }, ctx));
    expect(postings.map((p) => p.title)).toContain('Tech Lead Full-Stack Rails Engineer');
    expect(postings.length).toBeLessThan(4);
  });

  it('throws with the status when the response is not ok', async () => {
    const { ctx } = fakeCtx('', 503);
    await expect(collect(remotiveAdapter.search({ terms: [], region: '' }, ctx))).rejects.toThrow(/503/);
  });
});
