import { sqlite, parseJson } from './db';
import { isoAfter, nowIso } from './clock';
import { publish } from './events';
import { errorMessage, log } from './logger';
import { getSetting } from './settings';

export type TaskKind = 'enrich' | 'extract' | 'constraints' | 'judge' | 'score' | 'liveness' | 'derive_profile' | 'cover_letter' | 'match_analysis' | 'notify';

export type Lane = 'network' | 'llm' | 'code' | 'writing';

export const LANE_OF: Record<TaskKind, Lane> = {
  enrich: 'network',
  liveness: 'network',
  notify: 'network',
  extract: 'llm',
  judge: 'llm',
  // Writing tasks have their own lane, so a long match queue never delays a CV digest or a cover letter.
  derive_profile: 'writing',
  cover_letter: 'writing',
  match_analysis: 'writing',
  constraints: 'code',
  score: 'code',
};

const LANE_CONCURRENCY: Record<Lane, number> = { network: 2, llm: 1, code: 1, writing: 1 };

/** The user can pause these kinds with the "pause matching" control. */
const MATCH_KINDS: TaskKind[] = ['extract', 'constraints', 'judge', 'score'];

export const MAX_ATTEMPTS = 4;
const BACKOFF_BASE_MS = 30_000;

export interface TaskRow {
  id: number;
  kind: TaskKind;
  subject_id: string;
  payload: string;
  state: 'pending' | 'running' | 'done' | 'failed';
  attempts: number;
  priority: number;
  run_after: string;
  last_error: string | null;
  created_at: string;
  finished_at: string | null;
}

export interface TaskContext<P = Record<string, unknown>> {
  id: number;
  subjectId: string;
  payload: P;
  /** 1 for the first attempt. */
  attempt: number;
  isLastAttempt: boolean;
}

export type TaskHandler = (ctx: TaskContext<any>) => Promise<void>;

/**
 * A handler throws this when the provider that it needs is down.
 * The task returns to pending without a counted attempt, and the lane pauses.
 */
export class LaneUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LaneUnavailableError';
  }
}

const handlers = new Map<TaskKind, TaskHandler>();
const running: Record<Lane, number> = { network: 0, llm: 0, code: 0, writing: 0 };
const laneBlocked: Record<Lane, boolean> = { network: false, llm: false, code: false, writing: false };
let timer: ReturnType<typeof setInterval> | null = null;
let idleWaiters: Array<() => void> = [];

export function registerHandler(kind: TaskKind, handler: TaskHandler): void {
  handlers.set(kind, handler);
}

export interface EnqueueOptions {
  payload?: Record<string, unknown>;
  delayMs?: number;
  priority?: number;
}

/** Adds a task. Returns false when an unfinished task of the same kind and subject exists. */
export function enqueue(kind: TaskKind, subjectId: string, opts: EnqueueOptions = {}): boolean {
  const result = sqlite
    .prepare(
      `INSERT OR IGNORE INTO tasks (kind, subject_id, payload, state, priority, run_after, created_at)
       VALUES (?, ?, ?, 'pending', ?, ?, ?)`,
    )
    .run(kind, subjectId, JSON.stringify(opts.payload ?? {}), opts.priority ?? 0, isoAfter(opts.delayMs ?? 0), nowIso());
  if (result.changes > 0) {
    publish({ type: 'queue.changed' });
    kick();
    return true;
  }
  return false;
}

/** Call once at startup. Tasks that ran when the process stopped become pending again. */
export function recoverRunningTasks(): number {
  const r = sqlite.prepare(`UPDATE tasks SET state = 'pending', locked_at = NULL WHERE state = 'running'`).run();
  return r.changes;
}

export function setLaneBlocked(lane: Lane, blocked: boolean): void {
  if (laneBlocked[lane] === blocked) return;
  laneBlocked[lane] = blocked;
  if (!blocked) kick();
}

export function isLaneBlocked(lane: Lane): boolean {
  return laneBlocked[lane];
}

function claimable(lane: Lane): TaskKind[] {
  let kinds = (Object.keys(LANE_OF) as TaskKind[]).filter((k) => LANE_OF[k] === lane && handlers.has(k));
  if (getSetting('matching.paused')) kinds = kinds.filter((k) => !MATCH_KINDS.includes(k));
  return kinds;
}

function claim(lane: Lane): TaskRow | null {
  const kinds = claimable(lane);
  if (kinds.length === 0) return null;
  const marks = kinds.map(() => '?').join(',');
  const row = sqlite
    .prepare(
      `SELECT * FROM tasks WHERE state = 'pending' AND run_after <= ? AND kind IN (${marks})
       ORDER BY priority DESC, id ASC LIMIT 1`,
    )
    .get(nowIso(), ...kinds) as TaskRow | undefined;
  if (!row) return null;
  sqlite.prepare(`UPDATE tasks SET state = 'running', locked_at = ? WHERE id = ?`).run(nowIso(), row.id);
  return row;
}

async function execute(row: TaskRow, lane: Lane): Promise<void> {
  const handler = handlers.get(row.kind)!;
  const attempt = row.attempts + 1;
  try {
    await handler({
      id: row.id,
      subjectId: row.subject_id,
      payload: parseJson(row.payload, {}),
      attempt,
      isLastAttempt: attempt >= MAX_ATTEMPTS,
    });
    sqlite.prepare(`UPDATE tasks SET state = 'done', attempts = ?, finished_at = ?, last_error = NULL WHERE id = ?`).run(attempt, nowIso(), row.id);
  } catch (err) {
    if (err instanceof LaneUnavailableError) {
      sqlite.prepare(`UPDATE tasks SET state = 'pending', locked_at = NULL, last_error = ? WHERE id = ?`).run(err.message, row.id);
      setLaneBlocked(lane, true);
    } else if (attempt >= MAX_ATTEMPTS) {
      sqlite
        .prepare(`UPDATE tasks SET state = 'failed', attempts = ?, finished_at = ?, last_error = ? WHERE id = ?`)
        .run(attempt, nowIso(), errorMessage(err), row.id);
      log('error', `task ${row.kind} ${row.subject_id} failed after ${attempt} attempts: ${errorMessage(err)}`);
    } else {
      const delay = BACKOFF_BASE_MS * 2 ** (attempt - 1);
      sqlite
        .prepare(`UPDATE tasks SET state = 'pending', attempts = ?, run_after = ?, locked_at = NULL, last_error = ? WHERE id = ?`)
        .run(attempt, isoAfter(delay), errorMessage(err), row.id);
    }
  } finally {
    running[lane]--;
    publish({ type: 'queue.changed' });
    kick();
  }
}

/** Starts every task that can run now. Returns the number of started tasks. */
export function tick(): number {
  let started = 0;
  for (const lane of Object.keys(running) as Lane[]) {
    if (laneBlocked[lane]) continue;
    while (running[lane] < LANE_CONCURRENCY[lane]) {
      const row = claim(lane);
      if (!row) break;
      running[lane]++;
      started++;
      void execute(row, lane);
    }
  }
  if (started === 0 && activeCount() === 0) {
    const waiters = idleWaiters;
    idleWaiters = [];
    for (const w of waiters) w();
  }
  return started;
}

let kickScheduled = false;
function kick(): void {
  if (kickScheduled) return;
  kickScheduled = true;
  queueMicrotask(() => {
    kickScheduled = false;
    tick();
  });
}

function activeCount(): number {
  return running.network + running.llm + running.code + running.writing;
}

/** Resolves when no task runs and no task can start. Tests use it to wait for the pipeline. */
export function whenIdle(): Promise<void> {
  return new Promise((resolve) => {
    idleWaiters.push(resolve);
    kick();
  });
}

export function startWorker(intervalMs = 2000): void {
  if (timer) return;
  timer = setInterval(tick, intervalMs);
  timer.unref?.();
  kick();
}

export function stopWorker(): void {
  if (timer) clearInterval(timer);
  timer = null;
}

export function retryTask(id: number): boolean {
  const r = sqlite
    .prepare(`UPDATE tasks SET state = 'pending', attempts = 0, run_after = ?, last_error = NULL, finished_at = NULL WHERE id = ? AND state = 'failed'`)
    .run(nowIso(), id);
  if (r.changes > 0) kick();
  return r.changes > 0;
}

export function queueCounts(): Record<string, number> {
  const rows = sqlite.prepare(`SELECT kind, COUNT(*) AS n FROM tasks WHERE state IN ('pending', 'running') GROUP BY kind`).all() as Array<{
    kind: string;
    n: number;
  }>;
  const out: Record<string, number> = {};
  for (const r of rows) out[r.kind] = r.n;
  return out;
}

/** Deletes finished tasks that are older than the given age. Failed tasks stay for the activity view. */
export function pruneDoneTasks(olderThanMs = 7 * 86_400_000): void {
  sqlite.prepare(`DELETE FROM tasks WHERE state = 'done' AND finished_at < ?`).run(isoAfter(-olderThanMs));
}
