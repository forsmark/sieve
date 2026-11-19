import { beforeEach, describe, expect, it } from 'vitest';
import { config } from '../config';
import { resetDb, sqlite } from './db';
import { publish, subscribe, type AppEvent } from './events';
import { log } from './logger';
import { SETTING_DEFAULTS, getSetting, setSetting } from './settings';
import {
  LaneUnavailableError, MAX_ATTEMPTS, enqueue, isLaneBlocked, queueCounts, recoverRunningTasks, registerHandler, retryTask, setLaneBlocked, whenIdle,
} from './tasks';
import { fakeClock, resetAll, tasksOf } from '../testing/helpers';

beforeEach(resetAll);

describe('database', () => {
  it('uses an in-memory database in tests', () => {
    // This test fails when a test run opens a database file.
    expect(config.dbPath).toBe(':memory:');
    expect(sqlite.name).toBe(':memory:');
    expect(sqlite.memory).toBe(true);
    expect(() => resetDb()).not.toThrow();
  });

  it('creates all tables in an empty database at startup', () => {
    const names = (sqlite.prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`).all() as Array<{ name: string }>).map((r) => r.name);
    for (const table of [
      'postings', 'posting_facts', 'matches', 'profile', 'preferences', 'applications', 'application_events',
      'fetch_runs', 'fetch_run_sources', 'tasks', 'schedule', 'sessions', 'settings', 'logs', 'notifications', 'cover_letters',
    ]) {
      expect(names).toContain(table);
    }
  });
});

describe('task queue', () => {
  it('suppresses a duplicate of an unfinished task', async () => {
    let runs = 0;
    registerHandler('enrich', async () => {
      runs++;
    });
    expect(enqueue('enrich', 'a')).toBe(true);
    expect(enqueue('enrich', 'a')).toBe(false);
    expect(enqueue('enrich', 'b')).toBe(true);
    await whenIdle();
    expect(runs).toBe(2);
    // A finished task does not block a new one.
    expect(enqueue('enrich', 'a')).toBe(true);
    await whenIdle();
    expect(runs).toBe(3);
  });

  it('retries with backoff and fails after the retry limit', async () => {
    const clock = fakeClock();
    let attempts = 0;
    let sawLast = false;
    registerHandler('liveness', async (ctx) => {
      attempts++;
      sawLast = ctx.isLastAttempt;
      throw new Error('boom');
    });
    enqueue('liveness', 'x');
    await whenIdle();
    expect(attempts).toBe(1);
    expect(tasksOf('liveness')[0]).toMatchObject({ state: 'pending', attempts: 1, last_error: 'boom' });

    // The task does not run again before the backoff passes.
    clock.advance(29_000);
    await whenIdle();
    expect(attempts).toBe(1);

    for (let i = 0; i < 10; i++) {
      clock.advance(10 * 60_000);
      await whenIdle();
    }
    expect(attempts).toBe(MAX_ATTEMPTS);
    expect(sawLast).toBe(true);
    expect(tasksOf('liveness')[0]).toMatchObject({ state: 'failed', attempts: MAX_ATTEMPTS });

    // A manual retry starts the count again.
    expect(retryTask(tasksOf('liveness')[0]!.id)).toBe(true);
    await whenIdle();
    expect(attempts).toBe(MAX_ATTEMPTS + 1);
  });

  it('limits the number of tasks that run at the same time in each lane', async () => {
    const active = { llm: 0, network: 0 };
    const peak = { llm: 0, network: 0 };
    const work = (lane: 'llm' | 'network') => async () => {
      active[lane]++;
      peak[lane] = Math.max(peak[lane], active[lane]);
      await new Promise((r) => setTimeout(r, 15));
      active[lane]--;
    };
    registerHandler('extract', work('llm'));
    registerHandler('enrich', work('network'));
    for (let i = 0; i < 5; i++) {
      enqueue('extract', `p${i}`);
      enqueue('enrich', `p${i}`);
    }
    await whenIdle();
    expect(peak.llm).toBe(1);
    expect(peak.network).toBe(2);
    expect(tasksOf().every((t) => t.state === 'done')).toBe(true);
  });

  it('takes the task with the highest priority first', async () => {
    const order: string[] = [];
    registerHandler('extract', async (ctx) => {
      order.push(ctx.subjectId);
    });
    setLaneBlocked('llm', true);
    enqueue('extract', 'old', { priority: 1 });
    enqueue('extract', 'new', { priority: 9 });
    setLaneBlocked('llm', false);
    await whenIdle();
    expect(order).toEqual(['new', 'old']);
  });

  it('returns running tasks to pending after a restart', async () => {
    let runs = 0;
    registerHandler('enrich', async () => {
      runs++;
    });
    // A task that ran when the process stopped keeps the state "running" in the file.
    sqlite
      .prepare(`INSERT INTO tasks (kind, subject_id, payload, state, priority, run_after, created_at) VALUES ('enrich', 'p1', '{}', 'running', 0, ?, ?)`)
      .run(new Date(0).toISOString(), new Date(0).toISOString());
    await whenIdle();
    expect(runs).toBe(0);
    expect(recoverRunningTasks()).toBe(1);
    await whenIdle();
    expect(runs).toBe(1);
    expect(tasksOf('enrich')[0]!.state).toBe('done');
  });

  it('pauses a lane without a counted attempt when the provider is down', async () => {
    let fail = true;
    registerHandler('judge', async () => {
      if (fail) throw new LaneUnavailableError('provider is down');
    });
    enqueue('judge', 'p1');
    enqueue('judge', 'p2');
    await whenIdle();
    expect(isLaneBlocked('llm')).toBe(true);
    expect(tasksOf('judge').map((t) => [t.state, t.attempts])).toEqual([['pending', 0], ['pending', 0]]);
    fail = false;
    setLaneBlocked('llm', false);
    await whenIdle();
    expect(tasksOf('judge').every((t) => t.state === 'done')).toBe(true);
  });

  it('starts no match task while matching is paused, and still runs other kinds', async () => {
    const ran: string[] = [];
    registerHandler('extract', async () => void ran.push('extract'));
    registerHandler('score', async () => void ran.push('score'));
    registerHandler('derive_profile', async () => void ran.push('derive_profile'));
    setSetting('matching.paused', true);
    enqueue('extract', 'p1');
    enqueue('score', 'p1');
    enqueue('derive_profile', 'profile');
    await whenIdle();
    expect(ran).toEqual(['derive_profile']);
    expect(queueCounts()).toEqual({ extract: 1, score: 1 });
    setSetting('matching.paused', false);
    await whenIdle();
    expect(ran.sort()).toEqual(['derive_profile', 'extract', 'score']);
  });
});

describe('events', () => {
  it('delivers an event to every subscriber until it unsubscribes', () => {
    const seen: AppEvent[] = [];
    const stop = subscribe((e) => seen.push(e));
    publish({ type: 'profile.updated' });
    stop();
    publish({ type: 'queue.changed' });
    expect(seen).toEqual([{ type: 'profile.updated' }]);
  });
});

describe('settings and logger', () => {
  it('returns the default until a value is stored', () => {
    expect(getSetting('notifications')).toEqual(SETTING_DEFAULTS.notifications);
    expect(getSetting('llm').provider).toBe('local');
    expect(getSetting('matching.paused')).toBe(false);
  });

  it('stores and reads a value, and fills new fields from the default', () => {
    setSetting('search', { terms: ['react'], region: 'Copenhagen' });
    expect(getSetting('search')).toEqual({ terms: ['react'], region: 'Copenhagen' });
    sqlite.prepare(`INSERT INTO settings (key, value, updated_at) VALUES ('backup', '{"keep":3}', 'x')`).run();
    expect(getSetting('backup')).toEqual({ ...SETTING_DEFAULTS.backup, keep: 3 });
  });

  it('does not let a caller change the defaults', () => {
    getSetting('sources.disabled').push('x');
    expect(getSetting('sources.disabled')).toEqual([]);
  });

  it('writes log lines to the logs table', () => {
    log('warn', 'something happened');
    const rows = sqlite.prepare('SELECT level, message FROM logs').all();
    expect(rows).toEqual([{ level: 'warn', message: 'something happened' }]);
  });
});
