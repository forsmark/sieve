import { beforeEach, describe, expect, it } from 'vitest';
import { sqlite } from '../kernel/db';
import { setSetting } from '../kernel/settings';
import { recoverRunningTasks, registerHandler, setLaneBlocked, whenIdle } from '../kernel/tasks';
import { getPostingDetail, listPostings } from '../http/postings';
import { registerMatchingHandlers } from '../matching/handlers';
import { rescorePostings } from '../matching/rescore';
import { saveProfileEdits } from '../profile/service';
import type { HttpResult, RateLimitedClient, SourceAdapter } from '../sources/adapter';
import { listRuns, startFetchRun } from '../sources/runner';
import { FACTS, PROFILE, fakeClock, matchOf, postingOf, raw, resetAll, stubLlm, tasksOf } from '../testing/helpers';
import {
  classifyLiveness,
  extractJobText,
  mergeDescription,
  queueLivenessChecks,
  registerEnrichHandler,
  registerLivenessHandler,
  setEnrichClientForTests,
  setLivenessFetchForTests,
} from './enrich';
import { ingestPosting, needsEnrichment, separateDuplicate } from './ingest';
import { htmlToText, isSimilarTitle, normalizeCompany, normalizePosting, normalizeTitle } from './normalize';

beforeEach(async () => {
  await resetAll();
  setEnrichClientForTests(null);
  setLivenessFetchForTests(null);
});

function idOf(result: ReturnType<typeof ingestPosting>): string {
  if (result.status === 'invalid') throw new Error('posting is invalid');
  return result.id;
}

describe('normalization', () => {
  it('removes markup and keeps paragraph breaks', () => {
    const text = htmlToText('<p>We build <b>things</b> &amp; ship.</p><p>Second&nbsp;paragraph</p><ul><li>One</li><li>Two</li></ul><script>alert(1)</script>');
    expect(text).toBe('We build things & ship.\n\nSecond paragraph\n\n- One\n- Two');
  });

  it('treats Windows line ends as line ends', () => {
    expect(htmlToText('<p>One</p>\r\n\r\n\r\n<p>Two</p>\r\n')).toBe('One\n\nTwo');
    expect(htmlToText('One\r\n\r\n\r\n\r\nTwo')).toBe('One\n\nTwo');
  });

  it('stores a description without tags', () => {
    const n = normalizePosting(raw({ description: '<div><h2>About</h2><p>Hello</p></div>' }))!;
    expect(n.description).toBe('About\n\nHello');
    const id = idOf(ingestPosting('a', raw({ description: '<div><h2>About</h2><p>Hello <b>you</b></p><p>Second</p></div>' })));
    expect(postingOf(id).description).toBe('About\n\nHello you\n\nSecond');
  });

  it('discards a posting without a title, a company, or a valid link and counts it as invalid in the run history', async () => {
    setSetting('search', { terms: [], region: '' });
    const board: SourceAdapter = {
      id: 'board',
      name: 'Board',
      supports: { keywords: false, region: false },
      rate: { minDelayMs: 0, maxConcurrent: 1 },
      async *search() {
        yield raw({ externalId: 'ok' });
        yield raw({ externalId: 'no-title', title: '' });
        yield raw({ externalId: 'no-company', company: ' ' });
        yield raw({ externalId: 'no-link', url: 'not a link' });
      },
    };
    await startFetchRun('manual', { adapters: [board] })!.done;
    expect(sqlite.prepare('SELECT external_id FROM postings').all()).toEqual([{ external_id: 'ok' }]);
    expect(listRuns()[0]!.sources[0]).toMatchObject({ source: 'board', state: 'completed', found: 4, added: 1, invalid: 3 });
  });

  it.each([
    ['no title', { title: '  ' }],
    ['no company', { company: '' }],
    ['no identifier', { externalId: '' }],
    ['no link', { url: '' }],
    ['a link that is not a URL', { url: 'not a link' }],
    ['a link with another scheme', { url: 'javascript:alert(1)' }],
  ])('discards a posting with %s', (_name, patch) => {
    expect(normalizePosting(raw(patch))).toBeNull();
    expect(ingestPosting('a', raw(patch))).toEqual({ status: 'invalid' });
  });

  it('removes legal suffixes and seniority words for comparison', () => {
    expect(normalizeCompany('Acme A/S')).toBe(normalizeCompany('ACME ApS'));
    expect(normalizeCompany('Novo Nordisk A/S')).toBe('novo nordisk');
    expect(normalizeTitle('Senior Frontend Developer (m/f/d)')).toBe('frontend developer');
  });

  it('accepts an invalid posted date as unknown', () => {
    expect(normalizePosting(raw({ postedAt: 'yesterday' }))!.postedAt).toBeNull();
  });
});

describe('upsert', () => {
  it('keeps one record, its status, its score, and its first-seen time when a posting appears again', () => {
    const clock = fakeClock();
    const id = idOf(ingestPosting('a', raw()));
    sqlite.prepare(`UPDATE postings SET triage_status = 'saved' WHERE id = ?`).run(id);
    sqlite.prepare(`UPDATE matches SET state = 'scored', total_score = 77 WHERE posting_id = ?`).run(id);
    const before = postingOf(id);
    clock.advance(86_400_000);
    expect(ingestPosting('a', raw({ title: 'Frontend Developer (updated)' }))).toEqual({ status: 'existing', id });
    expect(sqlite.prepare('SELECT COUNT(*) AS n FROM postings').get()).toEqual({ n: 1 });
    const after = postingOf(id);
    expect(after.triage_status).toBe('saved');
    expect(after.first_seen_at).toBe(before.first_seen_at);
    expect(sqlite.prepare('SELECT total_score FROM matches WHERE posting_id = ?').get(id)).toEqual({ total_score: 77 });
  });

  it('adds a description that a later fetch returns', () => {
    const id = idOf(ingestPosting('a', raw({ description: null })));
    expect(postingOf(id).description).toBeNull();
    ingestPosting('a', raw());
    expect(postingOf(id).description).toContain('TypeScript');
    expect(tasksOf('extract').filter((t) => t.subject_id === id)).toHaveLength(1);
  });

  it('gives a new primary posting a match in the state "waiting" and one pipeline task', () => {
    const withText = idOf(ingestPosting('a', raw()));
    const withoutText = idOf(ingestPosting('a', raw({ externalId: 'job-2', title: 'Backend Developer', description: 'Short.' })));
    expect(sqlite.prepare('SELECT state FROM matches WHERE posting_id = ?').get(withText)).toEqual({ state: 'waiting' });
    expect(tasksOf().map((t) => [t.kind, t.subject_id])).toEqual([
      ['extract', withText],
      ['enrich', withoutText],
    ]);
  });
});

describe('duplicates', () => {
  it('marks the same job on a second board as a duplicate of the first', () => {
    const first = idOf(ingestPosting('jobindex', raw()));
    const second = ingestPosting('linkedin', raw({ externalId: 'li-9', url: 'https://linkedin.test/9' }));
    expect(second).toMatchObject({ status: 'duplicate', duplicateOf: first });
  });

  it('treats titles that differ by a seniority word or a legal suffix as the same job', () => {
    const first = idOf(ingestPosting('jobindex', raw({ title: 'Frontend Developer', company: 'Acme A/S' })));
    expect(ingestPosting('linkedin', raw({ externalId: 'x', title: 'Senior Frontend Developer', company: 'Acme ApS' }))).toMatchObject({
      status: 'duplicate',
      duplicateOf: first,
    });
  });

  it('finds a duplicate with extra words in the title through the company index', () => {
    const first = idOf(ingestPosting('jobindex', raw({ title: 'Frontend Developer' })));
    expect(ingestPosting('linkedin', raw({ externalId: 'x', title: 'Frontend Developer - Platform Team' }))).toMatchObject({
      status: 'duplicate',
      duplicateOf: first,
    });
    expect(isSimilarTitle('Frontend Developer', 'Frontend Developer, Copenhagen')).toBe(true);
  });

  it('keeps different roles at one company as primary records', () => {
    ingestPosting('jobindex', raw({ title: 'Frontend Developer' }));
    expect(ingestPosting('jobindex', raw({ externalId: 'x', title: 'Data Engineer' })).status).toBe('new');
    expect(ingestPosting('jobindex', raw({ externalId: 'y', title: 'Backend Developer' })).status).toBe('new');
    expect(isSimilarTitle('Developer', 'Backend Developer')).toBe(false);
    expect(isSimilarTitle('Product Manager', 'Engineering Manager')).toBe(false);
  });

  it('keeps the same title at two companies as two jobs', () => {
    ingestPosting('jobindex', raw());
    expect(ingestPosting('jobindex', raw({ externalId: 'x', company: 'Other Corp' })).status).toBe('new');
  });

  it('gives a duplicate no match and no task', () => {
    ingestPosting('jobindex', raw());
    const dup = idOf(ingestPosting('linkedin', raw({ externalId: 'x' })));
    expect(sqlite.prepare('SELECT 1 FROM matches WHERE posting_id = ?').get(dup)).toBeUndefined();
    expect(tasksOf().filter((t) => t.subject_id === dup)).toHaveLength(0);
  });

  it('keeps a duplicate out of the match queue and shows its source and link on the primary record', () => {
    const primary = idOf(ingestPosting('jobindex', raw()));
    const dup = idOf(ingestPosting('linkedin', raw({ externalId: 'li-9', url: 'https://linkedin.test/9' })));
    expect(postingOf(dup).duplicate_of).toBe(primary);
    expect(matchOf(dup)).toBeUndefined();
    expect(tasksOf().filter((t) => t.subject_id === dup)).toEqual([]);
    const detail = getPostingDetail(primary)!;
    expect(detail.sources).toEqual(['jobindex', 'linkedin']);
    expect(detail.sourceLinks).toEqual([
      { id: primary, source: 'jobindex', url: 'https://jobs.test/job-1', primary: true },
      { id: dup, source: 'linkedin', url: 'https://linkedin.test/9', primary: false },
    ]);
  });

  it('shows a job on two boards as one row in the ranked list', () => {
    const primary = idOf(ingestPosting('jobindex', raw()));
    ingestPosting('linkedin', raw({ externalId: 'li-9', url: 'https://linkedin.test/9' }));
    const list = listPostings({});
    expect(list.total).toBe(1);
    expect(list.items.map((i) => i.id)).toEqual([primary]);
    expect(list.items[0]!.sources).toEqual(['jobindex', 'linkedin']);
  });

  it('makes a separated duplicate a primary record with match tasks, and does not join it again', () => {
    const first = idOf(ingestPosting('jobindex', raw()));
    const dup = idOf(ingestPosting('linkedin', raw({ externalId: 'x' })));
    expect(separateDuplicate(dup)).toBe(true);
    expect(postingOf(dup)).toMatchObject({ duplicate_of: null, duplicate_locked: 1 });
    expect(sqlite.prepare('SELECT state FROM matches WHERE posting_id = ?').get(dup)).toEqual({ state: 'waiting' });
    expect(tasksOf('extract').some((t) => t.subject_id === dup)).toBe(true);
    // The next fetch returns both postings again. Each stays a primary record.
    ingestPosting('jobindex', raw());
    ingestPosting('linkedin', raw({ externalId: 'x' }));
    expect(postingOf(dup).duplicate_of).toBeNull();
    expect(postingOf(first).duplicate_of).toBeNull();
    expect(separateDuplicate(first)).toBe(false);
  });
});

const PAGE = `<html><head><script type="application/ld+json">${JSON.stringify({
  '@type': 'JobPosting',
  description: `<p>${'We look for a developer with TypeScript skills. '.repeat(8)}</p>`,
})}</script></head><body><nav>Menu</nav><main>Other</main></body></html>`;

function client(handler: (url: string) => { status: number; body: string }): RateLimitedClient {
  return {
    async get(url): Promise<HttpResult> {
      const r = handler(url);
      return { status: r.status, ok: r.status < 400, url, text: async () => r.body, json: async <T>() => JSON.parse(r.body) as T };
    },
  };
}

describe('enrichment', () => {
  it('reads the job text from structured data, and from the main content otherwise', () => {
    expect(extractJobText(PAGE)).toContain('TypeScript skills');
    const main = `<body><nav>${'Menu item. '.repeat(40)}</nav><main><p>${'Real job text here. '.repeat(20)}</p></main></body>`;
    const text = extractJobText(main)!;
    expect(text).toContain('Real job text');
    expect(text).not.toContain('Menu item');
    expect(extractJobText('<body><p>Too short</p></body>')).toBeNull();
    // Some systems put the whole page in one form. A small form is removed, and that form stays.
    const inForm = `<body><form><input name="q">Search</form><form id="page"><div><p>${'The job text is in the page form. '.repeat(12)}</p></div></form></body>`;
    const fromForm = extractJobText(inForm)!;
    expect(fromForm).toContain('The job text is in the page form.');
    expect(fromForm).not.toContain('Search');
    // A document without a body element still gives its text, and not the text of its head.
    const noBody = `<html><head><title>Page title</title></head><div><p>${'Text of a page without a body element. '.repeat(10)}</p></div></html>`;
    expect(extractJobText(noBody)).toContain('Text of a page without a body element.');
    expect(extractJobText(noBody)).not.toContain('Page title');
  });

  it('fetches the posting page for a posting without a description and stores the text', async () => {
    registerEnrichHandler();
    const urls: string[] = [];
    setEnrichClientForTests(() => client((url) => (urls.push(url), { status: 200, body: PAGE })));
    const id = idOf(ingestPosting('a', raw({ description: null })));
    await whenIdle();
    expect(urls).toEqual(['https://jobs.test/job-1']);
    expect(postingOf(id)).toMatchObject({ lacks_description: 0 });
    expect(postingOf(id).description).toContain('TypeScript skills');
    expect(tasksOf('extract').map((t) => t.subject_id)).toEqual([id]);
  });

  it('uses the description hook of the adapter when the source has one', async () => {
    registerEnrichHandler();
    const urls: string[] = [];
    const detail = `<div class="show-more-less-html__markup"><p>${'LinkedIn job text. '.repeat(20)}</p></div>`;
    setEnrichClientForTests(() => client((url) => (urls.push(url), { status: 200, body: detail })));
    const id = idOf(ingestPosting('linkedin', raw({ externalId: '4242', description: null, url: 'https://www.linkedin.com/jobs/view/4242' })));
    await whenIdle();
    expect(urls).toHaveLength(1);
    expect(urls[0]).toContain('jobPosting/4242');
    expect(postingOf(id).description).toContain('LinkedIn job text.');
  });

  it('fetches the full text for a source that gives only a teaser, also when the teaser is long', async () => {
    registerEnrichHandler();
    const urls: string[] = [];
    const jobPage = '<a class="btn seejobdesktop" href="https://www.jobindex.dk/jobannonce/r1/dev">Se jobbet</a><a class="btn" href="/c?t=h2">Se jobbet</a>';
    const ad = `<div class="jobtext-jobad__body"><p>${'The full advertisement text names Kubernetes. '.repeat(10)}</p></div><aside>Other jobs</aside>`;
    setEnrichClientForTests(() => client((url) => (urls.push(url), { status: 200, body: url.includes('/jobannonce/') ? ad : jobPage })));
    const id = idOf(ingestPosting('jobindex', raw({ externalId: 'r1', url: 'https://www.jobindex.dk/vis-job/r1' })));
    // The teaser is longer than the limit, and the posting still goes to the enrich task first.
    expect(tasksOf().map((t) => t.kind)).toEqual(['enrich']);
    await whenIdle();
    expect(urls).toEqual(['https://www.jobindex.dk/vis-job/r1', 'https://www.jobindex.dk/jobannonce/r1/dev']);
    const stored = postingOf(id);
    // The teaser stays in front of the full text.
    expect(stored.description).toMatch(/^This role needs TypeScript and React\./);
    expect(stored.description).toContain('names Kubernetes');
    expect(stored.description).not.toContain('Other jobs');
    expect(stored).toMatchObject({ lacks_description: 0 });
    expect(stored.enriched_at).toBeTruthy();
    expect(tasksOf('extract').map((t) => t.subject_id)).toEqual([id]);
  });

  it('keeps the teaser when the full text is not reachable, and does not try again', async () => {
    registerEnrichHandler();
    setEnrichClientForTests(() => client(() => ({ status: 404, body: '' })));
    const id = idOf(ingestPosting('jobindex', raw({ externalId: 'h1', url: 'https://www.jobindex.dk/vis-job/h1' })));
    await whenIdle();
    const stored = postingOf(id);
    expect(stored.description).toMatch(/^This role needs TypeScript and React\./);
    expect(stored).toMatchObject({ lacks_description: 0 });
    expect(stored.enriched_at).toBeTruthy();
    expect(needsEnrichment({ id, description: stored.description })).toBe(false);
    // The teaser goes to scoring, and no second enrich task follows.
    expect(tasksOf('extract').map((t) => t.subject_id)).toEqual([id]);
    expect(tasksOf('enrich')).toHaveLength(1);
  });

  it('fetches the full text first when the user rescores a posting that has only the teaser of its source', async () => {
    const id = idOf(ingestPosting('jobindex', raw({ externalId: 'r2', url: 'https://www.jobindex.dk/vis-job/r2' })));
    // The posting was scored from its teaser, and its full text was never fetched.
    sqlite.prepare('DELETE FROM tasks').run();
    expect(postingOf(id).enriched_at).toBeNull();
    registerEnrichHandler();
    const urls: string[] = [];
    const jobPage = '<a class="btn seejobdesktop" href="https://www.jobindex.dk/jobannonce/r2/dev">Se jobbet</a>';
    const ad = `<div class="jobtext-jobad__body"><p>${'The full advertisement text names Kubernetes. '.repeat(10)}</p></div>`;
    setEnrichClientForTests(() => client((url) => (urls.push(url), { status: 200, body: url.includes('/jobannonce/') ? ad : jobPage })));
    expect(rescorePostings([id])).toBe(1);
    expect(tasksOf().map((t) => t.kind)).toEqual(['enrich']);
    await whenIdle();
    expect(urls).toEqual(['https://www.jobindex.dk/vis-job/r2', 'https://www.jobindex.dk/jobannonce/r2/dev']);
    expect(postingOf(id).description).toContain('names Kubernetes');
    // Scoring follows the fetch.
    expect(tasksOf('extract').map((t) => t.subject_id)).toEqual([id]);
  });

  it('does not repeat a teaser that the fetched text already holds', () => {
    const teaser = 'We look for a developer who knows TypeScript and likes hard problems.';
    expect(mergeDescription(teaser, `We look for a developer who knows   TypeScript and likes hard problems. More text.`)).not.toMatch(/problems\.\n\nWe look/);
    expect(mergeDescription(teaser, 'Other text.')).toBe(`${teaser}\n\nOther text.`);
    expect(mergeDescription(null, 'Only text.')).toBe('Only text.');
  });

  it('marks the posting as lacking a description when the page gives no text, and still sends it to scoring', async () => {
    registerEnrichHandler();
    setEnrichClientForTests(() => client(() => ({ status: 403, body: '' })));
    const id = idOf(ingestPosting('a', raw({ description: null })));
    await whenIdle();
    expect(postingOf(id)).toMatchObject({ lacks_description: 1, description: null });
    expect(tasksOf('enrich')[0]).toMatchObject({ state: 'done' });
    expect(tasksOf('extract').map((t) => t.subject_id)).toEqual([id]);
  });

  it('keeps enrichment that waits at shutdown and runs it after startup without user action', async () => {
    // The process stops before the queue takes the task, so the task waits in the database.
    setLaneBlocked('network', true);
    registerEnrichHandler();
    setEnrichClientForTests(() => client(() => ({ status: 200, body: PAGE })));
    const id = idOf(ingestPosting('a', raw({ description: null })));
    await whenIdle();
    expect(tasksOf('enrich')).toMatchObject([{ subject_id: id, state: 'pending' }]);
    expect(postingOf(id).description).toBeNull();
    // Startup: a new process has only the stored queue, and no lane is blocked.
    recoverRunningTasks();
    setLaneBlocked('network', false);
    await whenIdle();
    expect(tasksOf('enrich')).toMatchObject([{ subject_id: id, state: 'done' }]);
    expect(postingOf(id).description).toContain('TypeScript skills');
  });

  it('resumes enrichment after a restart without user action', async () => {
    const id = idOf(ingestPosting('a', raw({ description: null })));
    // The process stopped while the task ran.
    sqlite.prepare(`UPDATE tasks SET state = 'running' WHERE kind = 'enrich'`).run();
    registerEnrichHandler();
    setEnrichClientForTests(() => client(() => ({ status: 200, body: PAGE })));
    recoverRunningTasks();
    await whenIdle();
    expect(postingOf(id).description).toContain('TypeScript skills');
  });
});

describe('link liveness', () => {
  const respond = (status: number, url?: string) => {
    setLivenessFetchForTests((async () => {
      const res = new Response(null, { status });
      if (url) Object.defineProperty(res, 'url', { value: url });
      return res;
    }) as typeof fetch);
  };

  it('reports a page that answers as active', async () => {
    respond(200);
    expect(await classifyLiveness('https://jobs.test/1')).toBe('active');
  });

  it('reports a removed page as expired', async () => {
    respond(404);
    expect(await classifyLiveness('https://jobs.test/1')).toBe('expired');
    respond(410);
    expect(await classifyLiveness('https://jobs.test/1')).toBe('expired');
    respond(200, 'https://jobs.test/job-expired');
    expect(await classifyLiveness('https://jobs.test/1')).toBe('expired');
  });

  it('uses GET when the site does not accept HEAD', async () => {
    const methods: string[] = [];
    setLivenessFetchForTests((async (_url: string, init: RequestInit) => {
      methods.push(init.method!);
      return new Response(null, { status: init.method === 'HEAD' ? 405 : 404 });
    }) as typeof fetch);
    expect(await classifyLiveness('https://jobs.test/1')).toBe('expired');
    expect(methods).toEqual(['HEAD', 'GET']);
  });

  it('reports every problem that does not prove removal as unknown', async () => {
    respond(403);
    expect(await classifyLiveness('https://jobs.test/1')).toBe('unknown');
    respond(503);
    expect(await classifyLiveness('https://jobs.test/1')).toBe('unknown');
    setLivenessFetchForTests((async () => {
      throw new Error('network down');
    }) as typeof fetch);
    expect(await classifyLiveness('https://jobs.test/1')).toBe('unknown');
  });

  it('checks old untriaged postings, stores the result, and checks an unknown link again later', async () => {
    const clock = fakeClock();
    registerLivenessHandler();
    registerHandler('extract', async () => {});
    const id = idOf(ingestPosting('a', raw()));
    expect(queueLivenessChecks()).toBe(0);
    clock.advance(4 * 86_400_000);
    respond(503);
    expect(queueLivenessChecks()).toBe(1);
    await whenIdle();
    expect(postingOf(id).link_status).toBe('unknown');
    expect(queueLivenessChecks()).toBe(0);
    clock.advance(25 * 3_600_000);
    respond(404);
    expect(queueLivenessChecks()).toBe(1);
    await whenIdle();
    expect(postingOf(id).link_status).toBe('expired');
    clock.advance(30 * 86_400_000);
    expect(queueLivenessChecks()).toBe(0);
  });
});

describe('scoring after failed enrichment', () => {
  it('scores a posting whose page gives no text from its title, company, and location, and flags that it lacks a description', async () => {
    const stub = stubLlm();
    registerMatchingHandlers();
    registerEnrichHandler();
    saveProfileEdits(PROFILE);
    await whenIdle();
    let factsInput = '';
    stub.facts = (user) => ((factsInput = user), FACTS);
    setEnrichClientForTests(() => client(() => ({ status: 403, body: '' })));
    const id = idOf(ingestPosting('a', raw({ description: null })));
    await whenIdle();
    expect(postingOf(id)).toMatchObject({ lacks_description: 1, description: null });
    expect(factsInput).toContain('Title: Frontend Developer');
    expect(factsInput).toContain('Company: Acme A/S');
    expect(factsInput).toContain('Location: Copenhagen');
    expect(factsInput).toContain('No description is available');
    expect(matchOf(id)!.state).toBe('scored');
    expect(getPostingDetail(id)).toMatchObject({ lacksDescription: true, match: { state: 'scored' } });
  });
});
