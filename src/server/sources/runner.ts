import { sqlite } from '../kernel/db';
import { nowIso, nowMs } from '../kernel/clock';
import { publish } from '../kernel/events';
import { errorMessage, log } from '../kernel/logger';
import { getSetting } from '../kernel/settings';
import { ingestPosting } from '../ingestion/ingest';
import type { SearchQuery, SourceAdapter } from './adapter';
import { createRateLimitedClient, realHttpDeps, type HttpClientDeps } from './http';
import { listAdapters } from './registry';

export type RunTrigger = 'manual' | 'schedule' | 'startup';

export interface RunOptions {
  adapters?: SourceAdapter[];
  /** Time limit for one source in milliseconds. */
  sourceTimeoutMs?: number;
  httpDeps?: HttpClientDeps;
}

let activeRun: Promise<number> | null = null;
let activeRunId: number | null = null;

export function isRunActive(): boolean {
  return activeRun !== null;
}

export function getActiveRunId(): number | null {
  return activeRunId;
}

/** Call once at startup. A run that was active when the process stopped is marked as interrupted. */
export function markInterruptedRuns(): void {
  const now = nowIso();
  sqlite.prepare(`UPDATE fetch_run_sources SET state = 'failed', error = 'interrupted by restart' WHERE state = 'running'`).run();
  sqlite.prepare(`UPDATE fetch_runs SET state = 'interrupted', ended_at = ? WHERE state = 'running'`).run(now);
}

async function runSource(runId: number, adapter: SourceAdapter, query: SearchQuery, opts: RunOptions): Promise<void> {
  const update = sqlite.prepare(`UPDATE fetch_run_sources SET state = ?, found = ?, added = ?, invalid = ?, error = ? WHERE run_id = ? AND source = ?`);
  let found = 0;
  let added = 0;
  let invalid = 0;
  const timeoutMs = opts.sourceTimeoutMs ?? 5 * 60_000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error(`source timed out after ${Math.round(timeoutMs / 1000)} s`)), timeoutMs);
  // The abort also ends an adapter that waits without a request.
  const aborted = new Promise<never>((_, reject) => {
    controller.signal.addEventListener('abort', () => reject(controller.signal.reason), { once: true });
  });
  aborted.catch(() => {});
  try {
    const ctx = {
      http: createRateLimitedClient(adapter.rate, controller.signal, opts.httpDeps ?? realHttpDeps),
      signal: controller.signal,
      log: (message: string) => log('info', `[${adapter.id}] ${message}`),
    };
    const iterator = adapter.search(query, ctx)[Symbol.asyncIterator]();
    let lastProgress = nowMs();
    while (true) {
      const next = await Promise.race([iterator.next(), aborted]);
      if (next.done) break;
      found++;
      const result = ingestPosting(adapter.id, next.value);
      if (result.status === 'invalid') invalid++;
      else if (result.status === 'new') added++;
      if (nowMs() - lastProgress > 1000) {
        lastProgress = nowMs();
        update.run('running', found, added, invalid, null, runId, adapter.id);
        publish({ type: 'run.progress', runId });
      }
    }
    update.run('completed', found, added, invalid, null, runId, adapter.id);
  } catch (err) {
    // Postings that arrived before the failure stay stored.
    update.run('failed', found, added, invalid, errorMessage(err), runId, adapter.id);
    log('warn', `[${adapter.id}] fetch failed: ${errorMessage(err)}`);
  } finally {
    clearTimeout(timer);
    publish({ type: 'run.progress', runId });
  }
}

async function execute(runId: number, opts: RunOptions): Promise<number> {
  const adapters = opts.adapters ?? listAdapters();
  const disabled = new Set(getSetting('sources.disabled'));
  const search = getSetting('search');
  const query: SearchQuery = { terms: search.terms.map((t) => t.trim()).filter(Boolean), region: search.region.trim() };
  const insert = sqlite.prepare(`INSERT INTO fetch_run_sources (run_id, source, state, error) VALUES (?, ?, ?, ?)`);

  const jobs: Promise<void>[] = [];
  for (const adapter of adapters) {
    if (disabled.has(adapter.id)) {
      insert.run(runId, adapter.id, 'skipped', 'source is disabled');
    } else if (adapter.supports.keywords && query.terms.length === 0) {
      insert.run(runId, adapter.id, 'skipped', 'no search terms');
    } else {
      insert.run(runId, adapter.id, 'running', null);
      // Sources run in parallel. Each one has its own rate limit and its own failure.
      jobs.push(runSource(runId, adapter, query, opts));
    }
  }
  publish({ type: 'run.progress', runId });
  await Promise.all(jobs);
  sqlite.prepare(`UPDATE fetch_runs SET state = 'completed', ended_at = ? WHERE id = ?`).run(nowIso(), runId);
  publish({ type: 'run.progress', runId });
  return runId;
}

/**
 * Starts a fetch run. At most one run is active.
 * Returns the run id and a promise that resolves when the run ends, or null when a run is already active.
 */
export function startFetchRun(trigger: RunTrigger, opts: RunOptions = {}): { runId: number; done: Promise<number> } | null {
  if (activeRun) return null;
  const info = sqlite.prepare(`INSERT INTO fetch_runs (trigger, state, started_at) VALUES (?, 'running', ?)`).run(trigger, nowIso());
  const runId = Number(info.lastInsertRowid);
  activeRunId = runId;
  activeRun = execute(runId, opts)
    .catch((err) => {
      log('error', `fetch run ${runId} failed: ${errorMessage(err)}`);
      sqlite.prepare(`UPDATE fetch_runs SET state = 'interrupted', ended_at = ? WHERE id = ?`).run(nowIso(), runId);
      return runId;
    })
    .finally(() => {
      activeRun = null;
      activeRunId = null;
    });
  return { runId, done: activeRun };
}

export interface RunView {
  id: number;
  trigger: string;
  state: string;
  startedAt: string;
  endedAt: string | null;
  sources: Array<{ source: string; state: string; found: number; added: number; invalid: number; error: string | null }>;
}

export function listRuns(limit = 20): RunView[] {
  const runs = sqlite.prepare(`SELECT * FROM fetch_runs ORDER BY id DESC LIMIT ?`).all(limit) as Array<{
    id: number;
    trigger: string;
    state: string;
    started_at: string;
    ended_at: string | null;
  }>;
  const sources = sqlite.prepare(`SELECT * FROM fetch_run_sources WHERE run_id = ? ORDER BY source`);
  return runs.map((r) => ({
    id: r.id,
    trigger: r.trigger,
    state: r.state,
    startedAt: r.started_at,
    endedAt: r.ended_at,
    sources: sources.all(r.id) as RunView['sources'],
  }));
}

export function lastCompletedRunAt(): string | null {
  const row = sqlite.prepare(`SELECT ended_at FROM fetch_runs WHERE state = 'completed' ORDER BY id DESC LIMIT 1`).get() as { ended_at: string } | undefined;
  return row?.ended_at ?? null;
}
