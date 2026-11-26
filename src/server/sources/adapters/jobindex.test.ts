import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FetchContext, HttpResult, RawPosting } from '../adapter';
import { buildJobindexUrl, jobindexAdapter, parseJobindexAd, parseJobindexHtml, parseJobindexTarget } from './jobindex';

const fixture = readFileSync(new URL('./__fixtures__/jobindex.html', import.meta.url), 'utf8');

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

describe('parseJobindexHtml', () => {
  it('parses the results embedded in the Stash script', () => {
    const postings = parseJobindexHtml(fixture);
    expect(postings).toHaveLength(4);
    expect(postings[0]).toMatchObject({
      externalId: 'h1714791',
      title: 'Senior Software Developer (blind recruitment)',
      company: 'DEIF A/S',
      location: 'Skive, Hybrid position',
      url: 'https://www.jobindex.dk/vis-job/h1714791',
      postedAt: '2026-11-09T00:00:00.000Z',
    });
    expect(postings[0]!.description).toContain('Are you a Senior Software Developer');
    expect(postings[0]!.description).not.toContain('Ikke interesseret');
    expect(postings[2]!.location).toBeNull();
    expect(postings[3]).toMatchObject({ externalId: 'r14095546', company: 'CORTAS', location: 'København' });
  });

  it('skips an item without a title', () => {
    const html = fixture.replace('"headline":"Senior Software Developer (blind recruitment)"', '"headline":null');
    const postings = parseJobindexHtml(html);
    expect(postings).toHaveLength(3);
    expect(postings.map((p) => p.externalId)).not.toContain('h1714791');
  });

  it('throws when the page has no Stash', () => {
    expect(() => parseJobindexHtml('<html></html>')).toThrow(/Stash/);
  });
});

describe('buildJobindexUrl', () => {
  it('puts a known region in the path and searches all of Denmark otherwise', () => {
    expect(buildJobindexUrl('developer', 'Copenhagen')).toBe('https://www.jobindex.dk/jobsoegning/storkoebenhavn?q=developer');
    expect(buildJobindexUrl('developer', 'Aarhus', 2)).toBe('https://www.jobindex.dk/jobsoegning/region-midtjylland?q=developer&page=2');
    expect(buildJobindexUrl('data engineer', '')).toBe('https://www.jobindex.dk/jobsoegning?q=data+engineer');
  });
});

describe('jobindexAdapter.search', () => {
  it('runs one search per term through ctx.http', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const { ctx, urls } = fakeCtx(fixture);
    const postings = await collect(jobindexAdapter.search({ terms: ['developer', 'engineer'], region: 'København' }, ctx));
    // The fixture says there are 51 pages, so each term reads the page limit (2). Repeats are dropped.
    expect(postings).toHaveLength(4);
    expect(urls).toEqual([
      'https://www.jobindex.dk/jobsoegning/storkoebenhavn?q=developer',
      'https://www.jobindex.dk/jobsoegning/storkoebenhavn?q=developer&page=2',
      'https://www.jobindex.dk/jobsoegning/storkoebenhavn?q=engineer',
      'https://www.jobindex.dk/jobsoegning/storkoebenhavn?q=engineer&page=2',
    ]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('makes no request when there are no terms', async () => {
    const { ctx, get } = fakeCtx(fixture);
    expect(await collect(jobindexAdapter.search({ terms: [], region: '' }, ctx))).toEqual([]);
    expect(get).not.toHaveBeenCalled();
  });

  it('throws with the status when the response is not ok', async () => {
    const { ctx } = fakeCtx('', 500);
    await expect(collect(jobindexAdapter.search({ terms: ['x'], region: '' }, ctx))).rejects.toThrow(/500/);
  });
});

describe('jobindexAdapter.fetchDescription', () => {
  const JOB_PAGE = (href: string) =>
    `<main><a class="btn btn-sm btn-primary seejobdesktop" data-click="/c?t=x" href="${href}">Se jobbet</a>
     <a class="btn btn-secondary btn-sm btn-block" href="/c?t=h999&amp;ctx=w">Se jobbet</a><p>${'Teaser of another job. '.repeat(20)}</p></main>`;
  const AD = `<div class="jobtext-jobad__header">Header</div><div class="jobtext-jobad__body"><p>${'Build cloud applications with TypeScript. '.repeat(8)}</p><script>track()</script></div><div class="jobtext-jobad__sidebar">Sidebar</div>`;

  function routes(map: Record<string, { status?: number; body: string }>) {
    const urls: string[] = [];
    const get = vi.fn(async (url: string): Promise<HttpResult> => {
      urls.push(url);
      const r = map[url] ?? { status: 404, body: '' };
      const status = r.status ?? 200;
      return { status, ok: status < 400, url, text: async () => r.body, json: async <T>() => JSON.parse(r.body) as T };
    });
    const ctx: FetchContext = { http: { get }, signal: new AbortController().signal, log: () => {} };
    return { ctx, urls };
  }

  it('reads the address behind the "Se jobbet" button, and only that of the main job', () => {
    expect(parseJobindexTarget(JOB_PAGE('https://www.jobindex.dk/jobannonce/r1/dev'), 'https://www.jobindex.dk/vis-job/r1')).toBe(
      'https://www.jobindex.dk/jobannonce/r1/dev',
    );
    expect(parseJobindexTarget(JOB_PAGE('https://x.test/ad?a=1&amp;b=2'), 'https://www.jobindex.dk/vis-job/h1')).toBe('https://x.test/ad?a=1&b=2');
    expect(parseJobindexTarget(JOB_PAGE('javascript:alert(1)'), 'https://www.jobindex.dk/vis-job/h1')).toBeNull();
    expect(parseJobindexTarget('<main>No button</main>', 'https://www.jobindex.dk/vis-job/h1')).toBeNull();
  });

  it('takes only the body of an advertisement on Jobindex', () => {
    const body = parseJobindexAd(AD)!;
    expect(body).toContain('Build cloud applications');
    expect(body).not.toContain('track()');
    expect(body).not.toContain('Sidebar');
    expect(parseJobindexAd('<main>Other page</main>')).toBeNull();
  });

  it('follows the button to an advertisement on Jobindex', async () => {
    const { ctx, urls } = routes({
      'https://www.jobindex.dk/vis-job/r1': { body: JOB_PAGE('https://www.jobindex.dk/jobannonce/r1/dev') },
      'https://www.jobindex.dk/jobannonce/r1/dev': { body: AD },
    });
    const text = await jobindexAdapter.fetchDescription!({ externalId: 'r1', url: 'https://www.jobindex.dk/vis-job/r1' }, ctx);
    expect(urls).toEqual(['https://www.jobindex.dk/vis-job/r1', 'https://www.jobindex.dk/jobannonce/r1/dev']);
    expect(text).toContain('Build cloud applications');
    expect(text).not.toContain('Teaser of another job');
  });

  it('follows the button to a page of the employer and reads the job text there', async () => {
    const employer = `<html><body><nav>Menu</nav><main><h1>Frontend Developer</h1><p>${'You build our web shop with React. '.repeat(10)}</p></main></body></html>`;
    const { ctx } = routes({
      'https://www.jobindex.dk/vis-job/h1': { body: JOB_PAGE('https://careers.acme.test/jobs/1') },
      'https://careers.acme.test/jobs/1': { body: employer },
    });
    const text = await jobindexAdapter.fetchDescription!(
      { externalId: 'h1', url: 'https://www.jobindex.dk/vis-job/h1', title: 'Frontend Developer', company: 'Acme' },
      ctx,
    );
    expect(text).toContain('You build our web shop with React.');
  });

  it('gives nothing when the page of the employer does not name the job, has an error, or has no button', async () => {
    const consent = `<html><body><p>${'We use cookies to improve your experience. '.repeat(10)}</p></body></html>`;
    const posting = { externalId: 'h1', url: 'https://www.jobindex.dk/vis-job/h1', title: 'Frontend Developer', company: 'Acme' };
    const a = routes({ [posting.url]: { body: JOB_PAGE('https://careers.acme.test/jobs/1') }, 'https://careers.acme.test/jobs/1': { body: consent } });
    expect(await jobindexAdapter.fetchDescription!(posting, a.ctx)).toBeNull();
    const b = routes({ [posting.url]: { body: JOB_PAGE('https://careers.acme.test/jobs/1') }, 'https://careers.acme.test/jobs/1': { status: 403, body: '' } });
    expect(await jobindexAdapter.fetchDescription!(posting, b.ctx)).toBeNull();
    const c = routes({ [posting.url]: { body: '<main>No button</main>' } });
    expect(await jobindexAdapter.fetchDescription!(posting, c.ctx)).toBeNull();
    expect(c.urls).toEqual([posting.url]);
  });
});
