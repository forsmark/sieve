import { sqlite } from '../kernel/db';
import { isoAfter, nowIso } from '../kernel/clock';
import { isRunActive, lastCompletedRunAt, startFetchRun, type RunOptions } from './runner';

export interface ScheduleState {
  intervalHours: number;
  paused: boolean;
  nextRunAt: string | null;
}

const HOUR = 3_600_000;

export function getSchedule(): ScheduleState {
  let row = sqlite.prepare('SELECT interval_hours, paused, next_run_at FROM schedule WHERE id = 1').get() as
    { interval_hours: number; paused: number; next_run_at: string | null } | undefined;
  if (!row) {
    sqlite.prepare('INSERT INTO schedule (id, interval_hours, paused, next_run_at) VALUES (1, 4, 0, NULL)').run();
    row = { interval_hours: 4, paused: 0, next_run_at: null };
  }
  return { intervalHours: row.interval_hours, paused: row.paused === 1, nextRunAt: row.next_run_at };
}

export function updateSchedule(patch: { intervalHours?: number; paused?: boolean }): ScheduleState {
  const current = getSchedule();
  const intervalHours = Math.min(168, Math.max(1, Math.round(patch.intervalHours ?? current.intervalHours)));
  const paused = patch.paused ?? current.paused;
  let nextRunAt = current.nextRunAt;
  if (intervalHours !== current.intervalHours) {
    const last = lastCompletedRunAt();
    nextRunAt = last ? new Date(new Date(last).getTime() + intervalHours * HOUR).toISOString() : nowIso();
  }
  sqlite.prepare('UPDATE schedule SET interval_hours = ?, paused = ?, next_run_at = ? WHERE id = 1').run(intervalHours, paused ? 1 : 0, nextRunAt);
  return { intervalHours, paused, nextRunAt };
}

/**
 * Starts a run when one is due. The timer calls this once a minute and once at startup.
 * A run is due when the schedule is not paused and the interval passed after the last completed run.
 */
export function checkSchedule(opts: RunOptions = {}): { started: boolean; done?: Promise<number> } {
  const s = getSchedule();
  if (s.paused || isRunActive()) return { started: false };
  const last = lastCompletedRunAt();
  const dueAt = last ? new Date(last).getTime() + s.intervalHours * HOUR : 0;
  if (new Date(nowIso()).getTime() < dueAt) return { started: false };
  const run = startFetchRun('schedule', opts);
  if (!run) return { started: false };
  sqlite.prepare('UPDATE schedule SET next_run_at = ? WHERE id = 1').run(isoAfter(s.intervalHours * HOUR));
  void run.done.then(() => {
    sqlite.prepare('UPDATE schedule SET next_run_at = ? WHERE id = 1').run(isoAfter(getSchedule().intervalHours * HOUR));
  });
  return { started: true, done: run.done };
}

let timer: ReturnType<typeof setInterval> | null = null;

export function startScheduleTimer(): void {
  if (timer) return;
  checkSchedule();
  timer = setInterval(() => checkSchedule(), 60_000);
  timer.unref?.();
}

export function stopScheduleTimer(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
