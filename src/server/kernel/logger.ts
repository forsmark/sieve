import { sqlite } from './db';
import { nowIso } from './clock';
import { config } from '../config';

export type LogLevel = 'info' | 'warn' | 'error';

const MAX_ROWS = 5000;
let writes = 0;

/** Writes one line to the console and to the logs table. The activity view reads the table. */
export function log(level: LogLevel, message: string): void {
  if (!config.isTest) {
    const line = `[${level}] ${message}`;
    if (level === 'error') console.error(line);
    else if (level === 'warn') console.warn(line);
    else console.log(line);
  }
  try {
    sqlite.prepare('INSERT INTO logs (level, message, created_at) VALUES (?, ?, ?)').run(level, message.slice(0, 2000), nowIso());
    if (++writes % 200 === 0) {
      sqlite.prepare('DELETE FROM logs WHERE id <= (SELECT MAX(id) FROM logs) - ?').run(MAX_ROWS);
    }
  } catch {
    // Logging must never break the caller.
  }
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
