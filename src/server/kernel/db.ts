import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../config';

const migrationsFolder = resolve(dirname(fileURLToPath(import.meta.url)), '../../../drizzle');

if (config.dbPath !== ':memory:') mkdirSync(dirname(config.dbPath), { recursive: true });

/** The one database connection of the process. Tests get a fresh in-memory database for each test file. */
export const sqlite = new Database(config.dbPath);
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('foreign_keys = ON');

migrate(drizzle(sqlite), { migrationsFolder });

const TABLES = [
  'postings', 'posting_facts', 'matches', 'profile', 'preferences', 'applications', 'application_events',
  'fetch_runs', 'fetch_run_sources', 'tasks', 'schedule', 'sessions', 'settings', 'logs', 'notifications', 'cover_letters', 'match_analyses',
];

/** Test helper. Removes all rows. Refuses to run on a file database. */
export function resetDb(): void {
  if (sqlite.name !== ':memory:') throw new Error('resetDb is only allowed on an in-memory database');
  for (const t of TABLES) sqlite.prepare(`DELETE FROM ${t}`).run();
  sqlite.prepare(`DELETE FROM sqlite_sequence`).run();
}

export function parseJson<T>(text: string | null | undefined, fallback: T): T {
  if (text == null) return fallback;
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}
