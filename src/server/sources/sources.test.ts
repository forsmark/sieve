import { beforeEach, describe, expect, it } from 'vitest';
import { sqlite } from '../kernel/db';
import { setSetting } from '../kernel/settings';
import { fakeClock, raw, resetAll } from '../testing/helpers';
import type { FetchContext, RawPosting, SearchQuery, SourceAdapter } from './adapter';
import { createRateLimitedClient, type HttpClientDeps } from './http';
import { listAdapters } from './registry';
import { isRunActive, listRuns, markInterruptedRuns, startFetchRun } from './runner';
import { checkSchedule, getSchedule, startScheduleTimer, stopScheduleTimer, updateSchedule } from './schedule';

beforeEach(resetAll);

function adapter(
  id: string,
  items: RawPosting[] | ((query: SearchQuery, ctx: FetchContext) => AsyncIterable<RawPosting>),
  keywords = true,
): SourceAdapter & { queries: SearchQuery[] } {
  const queries: SearchQuery[] = [];
  return {
    id,
    name: id,
    supports: { keywords, region: true },
    rate: { minDelayMs: 0, maxConcurrent: 1 },
    queries,
    search(query, ctx) {
      queries.push(query);
      if (typeof items === 'function') return items(query, ctx);
      return (async function* () {
        yield* items;
      })();
    },
  };
}

function fakeHttp(responses: Array<() => Response>) {
  let now = 0;
  const sleeps: number[] = [];
  const starts: number[] = [];
  let i = 0;
  const deps: HttpClientDeps = {
    now: () => now,
    sleep: async (ms) => {
      sleeps.push(ms);
      now += ms;
    },
    fetch: async () => {
      starts.push(now);
      return responses[Math.min(i++, responses.length - 1)]!();
    },
  };
  return { deps, sleeps, starts };
}

describe('source contract', () => {
  it('has five adapters with a stable identifier, a name, and the inputs they support', () => {
    const adapters = listAdapters();
    expect(adapters.map((a) => a.id).sort()).toEqual(['arbeitnow', 'jobindex', 'linkedin', 'remoteok', 'remotive']);
    for (const a of adapters) {
      expect(a.name.length).toBeGreaterThan(0);
      expect(typeof a.supports.keywords).toBe('boolean');
      expect(a.rate.minDelayMs).toBeGreaterThan(0);
    }
  });

  it('lets a fake adapter yield postings through the runner', async () => {
    setSetting('search', { terms: ['react'], region: 'Copenhagen' });
    const fake = adapter('fake', [raw()]);
    await startFetchRun('manual', { adapters: [fake] })!.done;
    expect(fake.queries).toEqual([{ terms: ['react'], region: 'Copenhagen' }]);
    expect(sqlite.prepare('SELECT source, title FROM postings').all()).toEqual([{ source: 'fake', title: 'Frontend Developer' }]);
  });
});

describe('rate-limited HTTP client', () => {
  it('starts two requests at least the minimum delay apart', async () => {
    const http = fakeHttp([() => new Response('ok')]);
    const client = createRateLimitedClient({ minDelayMs: 2000, maxConcurrent: 1 }, new AbortController().signal, http.deps);
    await client.get('https://a.test/1');
    await client.get('https://a.test/2');
    await client.get('https://a.test/3');
    expect(http.starts).toEqual([0, 2000, 4000]);
  });

  it('waits for the Retry-After time after a 429, and delays later requests of the same source', async () => {
    const http = fakeHttp([() => new Response('', { status: 429, headers: { 'Retry-After': '7' } }), () => new Response('ok')]);
    const client = createRateLimitedClient({ minDelayMs: 100, maxConcurrent: 1 }, new AbortController().signal, http.deps);
    const res = await client.get('https://a.test/1');
    expect(res.status).toBe(200);
    expect(http.starts).toEqual([0, 7000]);

    // Another source has its own client and does not wait.
    const other = fakeHttp([() => new Response('ok')]);
    await createRateLimitedClient({ minDelayMs: 100, maxConcurrent: 1 }, new AbortController().signal, other.deps).get('https://b.test/1');
    expect(other.sleeps).toEqual([]);
  });

  it('retries a 5xx response with a growing backoff and then returns the last response', async () => {
    const http = fakeHttp([() => new Response('', { status: 503 })]);
    const client = createRateLimitedClient({ minDelayMs: 0, maxConcurrent: 1 }, new AbortController().signal, http.deps);
    const res = await client.get('https://a.test/1');
    expect(res.status).toBe(503);
    expect(res.ok).toBe(false);
    expect(http.starts).toEqual([0, 2000, 6000, 14000]);
  });
});

describe('fetch runner', () => {
  beforeEach(() => setSetting('search', { terms: ['react'], region: '' }));

  it('records found and new postings for each source', async () => {
    const a = adapter('a', [raw({ externalId: '1' }), raw({ externalId: '2', title: 'Backend Developer' }), raw({ externalId: '3', title: '' })]);
    const run = startFetchRun('manual', { adapters: [a] })!;
    expect(isRunActive()).toBe(true);
    await run.done;
    expect(isRunActive()).toBe(false);
    const [view] = listRuns();
    expect(view).toMatchObject({ id: run.runId, trigger: 'manual', state: 'completed' });
    expect(view!.sources).toEqual([{ run_id: run.runId, source: 'a', state: 'completed', found: 3, added: 2, invalid: 1, error: null }]);

    // The same postings in a second run are found and not new.
    await startFetchRun('manual', { adapters: [a] })!.done;
    expect(listRuns()[0]!.sources[0]).toMatchObject({ found: 3, added: 0, invalid: 1 });
  });

  it('completes the other sources when one source fails', async () => {
    const bad = adapter('bad', async function* () {
      yield raw({ externalId: 'kept', title: 'Data Engineer' });
      throw new Error('HTTP 500 from board');
    });
    const good = adapter('good', [raw({ externalId: 'g1' })]);
    await startFetchRun('manual', { adapters: [bad, good] })!.done;
    const sources = listRuns()[0]!.sources;
    expect(sources.find((s) => s.source === 'bad')).toMatchObject({ state: 'failed', error: 'HTTP 500 from board', added: 1 });
    expect(sources.find((s) => s.source === 'good')).toMatchObject({ state: 'completed', added: 1 });
    expect(listRuns()[0]!.state).toBe('completed');
  });

  it('marks a source that passes its time limit as failed and keeps its earlier postings', async () => {
    const slow = adapter('slow', async function* () {
      yield raw({ externalId: 's1' });
      await new Promise(() => {});
    });
    await startFetchRun('manual', { adapters: [slow], sourceTimeoutMs: 40 })!.done;
    const source = listRuns()[0]!.sources[0]!;
    expect(source.state).toBe('failed');
    expect(source.error).toContain('timed out');
    expect(source.added).toBe(1);
    expect(sqlite.prepare('SELECT COUNT(*) AS n FROM postings').get()).toEqual({ n: 1 });
  });

  it('makes no request to a disabled source and shows it as skipped', async () => {
    const off = adapter('off', [raw()]);
    const on = adapter('on', [raw({ externalId: 'x' })]);
    setSetting('sources.disabled', ['off']);
    await startFetchRun('manual', { adapters: [off, on] })!.done;
    expect(off.queries).toHaveLength(0);
    expect(listRuns()[0]!.sources.find((s) => s.source === 'off')).toMatchObject({ state: 'skipped' });
    expect(on.queries).toHaveLength(1);
  });

  it('keeps the postings of a source after the source is disabled', async () => {
    const board = adapter('board', [raw({ externalId: '1' }), raw({ externalId: '2', title: 'Data Engineer' })]);
    await startFetchRun('manual', { adapters: [board] })!.done;
    setSetting('sources.disabled', ['board']);
    await startFetchRun('manual', { adapters: [board] })!.done;
    expect(listRuns()[0]!.sources[0]).toMatchObject({ source: 'board', state: 'skipped' });
    expect(sqlite.prepare('SELECT source, external_id FROM postings ORDER BY external_id').all()).toEqual([
      { source: 'board', external_id: '1' },
      { source: 'board', external_id: '2' },
    ]);
  });

  it('fetches only from sources that need no keywords when the user saved no search terms', async () => {
    setSetting('search', { terms: [], region: '' });
    const keyword = adapter('keyword', [raw()]);
    const feed = adapter('feed', [raw({ externalId: 'f' })], false);
    await startFetchRun('manual', { adapters: [keyword, feed] })!.done;
    expect(keyword.queries).toHaveLength(0);
    expect(feed.queries).toHaveLength(1);
    expect(listRuns()[0]!.sources.find((s) => s.source === 'keyword')).toMatchObject({ state: 'skipped', error: 'no search terms' });
  });

  it('uses new search terms in the next run', async () => {
    const a = adapter('a', []);
    const b = adapter('b', []);
    await startFetchRun('manual', { adapters: [a, b] })!.done;
    setSetting('search', { terms: ['vue', 'svelte'], region: 'Aarhus' });
    await startFetchRun('manual', { adapters: [a, b] })!.done;
    expect(a.queries).toEqual([
      { terms: ['react'], region: '' },
      { terms: ['vue', 'svelte'], region: 'Aarhus' },
    ]);
    expect(b.queries).toEqual(a.queries);
  });

  it('starts no second run while a run is active', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const a = adapter('a', async function* () {
      await gate;
    });
    const first = startFetchRun('manual', { adapters: [a] });
    expect(first).not.toBeNull();
    expect(startFetchRun('manual', { adapters: [a] })).toBeNull();
    expect(checkSchedule({ adapters: [a] }).started).toBe(false);
    release();
    await first!.done;
    expect(listRuns()).toHaveLength(1);
  });

  it('shows a run that was active at a restart as interrupted', () => {
    sqlite.prepare(`INSERT INTO fetch_runs (trigger, state, started_at) VALUES ('manual', 'running', '2026-01-01T00:00:00.000Z')`).run();
    sqlite.prepare(`INSERT INTO fetch_run_sources (run_id, source, state) VALUES (1, 'a', 'running')`).run();
    markInterruptedRuns();
    expect(listRuns()[0]).toMatchObject({ state: 'interrupted' });
    expect(listRuns()[0]!.sources[0]).toMatchObject({ state: 'failed', error: 'interrupted by restart' });
  });
});

describe('schedule', () => {
  const HOUR = 3_600_000;
  const opts = () => ({ adapters: [adapter('a', [], false)] });

  it('starts a run when the interval passes after the last completed run', async () => {
    const clock = fakeClock();
    await startFetchRun('manual', opts())!.done;
    expect(getSchedule().intervalHours).toBe(4);
    clock.advance(4 * HOUR - 60_000);
    expect(checkSchedule(opts()).started).toBe(false);
    clock.advance(2 * 60_000);
    const result = checkSchedule(opts());
    expect(result.started).toBe(true);
    await result.done;
    expect(listRuns().map((r) => r.trigger)).toEqual(['schedule', 'manual']);
    expect(getSchedule().nextRunAt).toBe(new Date(clock.now() + 4 * HOUR).toISOString());
  });

  it('starts a run at once at startup when the last completed run is older than the interval', async () => {
    const clock = fakeClock();
    await startFetchRun('manual', opts())!.done;
    clock.advance(9 * HOUR);
    // This is the check that the server makes when it starts.
    const result = checkSchedule(opts());
    expect(result.started).toBe(true);
    await result.done;
  });

  it('starts a run at the first start, when no run exists', async () => {
    const result = checkSchedule(opts());
    expect(result.started).toBe(true);
    await result.done;
  });

  it('starts no run while fetching is paused, and keeps the pause after a restart', async () => {
    const clock = fakeClock();
    await startFetchRun('manual', opts())!.done;
    updateSchedule({ paused: true });
    clock.advance(48 * HOUR);
    expect(checkSchedule(opts()).started).toBe(false);
    expect(getSchedule().paused).toBe(true);
    updateSchedule({ paused: false });
    const result = checkSchedule(opts());
    expect(result.started).toBe(true);
    await result.done;
  });

  it('keeps fetching paused after a restart and starts no run at startup', async () => {
    const clock = fakeClock();
    // Every real source is disabled, so a wrong start would make no network request.
    setSetting(
      'sources.disabled',
      listAdapters().map((a) => a.id),
    );
    await startFetchRun('manual', opts())!.done;
    updateSchedule({ paused: true });
    clock.advance(48 * HOUR);
    // The paused state lives in the database. Startup reads it from there and checks the schedule at once.
    startScheduleTimer();
    stopScheduleTimer();
    expect(getSchedule().paused).toBe(true);
    expect(isRunActive()).toBe(false);
    expect(listRuns()).toHaveLength(1);
  });

  it('stores the interval and limits it to a valid range', () => {
    expect(updateSchedule({ intervalHours: 12 }).intervalHours).toBe(12);
    expect(updateSchedule({ intervalHours: 0 }).intervalHours).toBe(1);
    expect(getSchedule().intervalHours).toBe(1);
  });
});
