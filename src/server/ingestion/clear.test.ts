import { existsSync, mkdirSync, mkdtempSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';
import { listApplicationEvents, listApplications, updateApplication } from '../applications/service';
import { backupDir, createBackup, listBackups, setBackupDirForTests } from '../http/backup';
import { setTriage } from '../http/postings';
import { sqlite } from '../kernel/db';
import { subscribe, type AppEvent } from '../kernel/events';
import { getSetting, setSetting } from '../kernel/settings';
import { whenIdle } from '../kernel/tasks';
import { registerMatchingHandlers } from '../matching/handlers';
import { getProfile, saveProfileEdits } from '../profile/service';
import type { SourceAdapter } from '../sources/adapter';
import { startFetchRun } from '../sources/runner';
import { FACTS, PROFILE, matchOf, postingOf, raw, resetAll, stubLlm, tasksOf, type StubLlm } from '../testing/helpers';
import { ClearError, clearPostings, clearPreview } from './clear';
import { ingestPosting } from './ingest';

let stub: StubLlm;

beforeEach(async () => {
  await resetAll();
  setBackupDirForTests(mkdtempSync(join(tmpdir(), 'sieve-clear-')));
  stub = stubLlm();
  registerMatchingHandlers();
  saveProfileEdits(PROFILE);
});

function add(source: string, externalId: string, title = `Developer ${externalId}`, company = `Company ${externalId}`): string {
  const r = ingestPosting(source, raw({ externalId, title, company, url: `https://jobs.test/${externalId}` }));
  if (r.status === 'invalid') throw new Error('invalid');
  return r.id;
}

function postingIds(): string[] {
  return (sqlite.prepare('SELECT id FROM postings ORDER BY id').all() as Array<{ id: string }>).map((r) => r.id);
}

function rows(table: string, id: string): number {
  return (sqlite.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE posting_id = ?`).get(id) as { n: number }).n;
}

/** Postings in each triage status, one with an application, each with a score, a letter, an analysis, and open and failed work. */
async function seed() {
  const fresh = add('remotive', 'new-1');
  const saved = add('remotive', 'saved-1');
  const dismissed = add('remotive', 'dismissed-1');
  const applied = add('remotive', 'applied-1');
  await whenIdle();
  setTriage(saved, 'saved');
  setTriage(dismissed, 'dismissed');
  setTriage(applied, 'applied');
  updateApplication(applied, { stage: 'interview', notes: 'Call on Monday.' });
  const now = new Date().toISOString();
  for (const id of [fresh, applied]) {
    sqlite.prepare(`INSERT INTO cover_letters (posting_id, state, text, updated_at) VALUES (?, 'ready', 'Dear team', ?)`).run(id, now);
    sqlite.prepare(`INSERT INTO match_analyses (posting_id, state, content_json, updated_at) VALUES (?, 'ready', '{}', ?)`).run(id, now);
  }
  sqlite
    .prepare(`INSERT INTO tasks (kind, subject_id, state, run_after, created_at) VALUES ('liveness', ?, 'pending', ?, ?)`)
    .run(fresh, '2999-01-01T00:00:00.000Z', now);
  sqlite
    .prepare(`INSERT INTO tasks (kind, subject_id, state, last_error, run_after, created_at) VALUES ('judge', ?, 'failed', 'boom', ?, ?)`)
    .run(dismissed, now, now);
  sqlite
    .prepare(`INSERT INTO tasks (kind, subject_id, state, run_after, created_at) VALUES ('liveness', ?, 'pending', ?, ?)`)
    .run(applied, '2999-01-01T00:00:00.000Z', now);
  return { fresh, saved, dismissed, applied };
}

/** Clears with the counts that the page shows now, as a user who confirms at once. */
function clearNow() {
  return clearPostings(clearPreview());
}

/** A source whose search waits until `release` runs, so the fetch run stays active. */
function slowSource() {
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const adapter: SourceAdapter = {
    id: 'slow',
    name: 'Slow',
    supports: { keywords: false, region: false },
    rate: { minDelayMs: 0, maxConcurrent: 1 },
    async *search() {
      await gate;
    },
  };
  return { adapter, release };
}

describe('clear postings', () => {
  it('deletes every posting without an application, with its score, letter, analysis, and work, and keeps the profile and the settings', async () => {
    const { fresh, saved, dismissed, applied } = await seed();
    setSetting('search', { terms: ['frontend'], region: 'Denmark' });
    const events: AppEvent[] = [];
    const unsubscribe = subscribe((e) => events.push(e));

    const result = await clearNow();
    unsubscribe();

    expect(result).toMatchObject({ deleted: 3, kept: 1 });
    expect(postingIds()).toEqual([applied]);
    for (const id of [fresh, saved, dismissed]) {
      for (const table of ['posting_facts', 'matches', 'cover_letters', 'match_analyses']) expect(rows(table, id)).toBe(0);
    }
    expect(tasksOf().filter((t) => [fresh, saved, dismissed].includes(t.subject_id))).toEqual([]);
    expect(getProfile().effective).toEqual(PROFILE);
    expect(getSetting('search')).toEqual({ terms: ['frontend'], region: 'Denmark' });
    expect(events.map((e) => e.type)).toEqual(expect.arrayContaining(['postings.cleared', 'queue.changed']));
  });

  it('keeps a posting with an application, with its score, its letter, its open work, and its application in its stage', async () => {
    const { applied } = await seed();
    const scoreBefore = matchOf(applied)!.total_score;
    expect(scoreBefore).not.toBeNull();

    await clearNow();

    expect(postingOf(applied)).toMatchObject({ triage_status: 'applied' });
    expect(matchOf(applied)).toMatchObject({ state: 'scored', total_score: scoreBefore });
    expect(rows('posting_facts', applied)).toBe(1);
    expect(rows('cover_letters', applied)).toBe(1);
    expect(rows('match_analyses', applied)).toBe(1);
    expect(tasksOf('liveness').map((t) => t.subject_id)).toEqual([applied]);
    expect(listApplications()).toMatchObject([{ postingId: applied, stage: 'interview', notes: 'Call on Monday.', totalScore: scoreBefore }]);
    expect(listApplicationEvents(applied)).toHaveLength(2);
  });

  it('keeps the primary record of an applied duplicate, and deletes the other duplicates of a kept primary', async () => {
    const primary = add('remotive', 'p-1', 'Frontend Developer', 'Acme A/S');
    const applied = add('jobindex', 'p-2', 'Frontend Developer', 'Acme A/S');
    const other = add('arbeitnow', 'p-3', 'Frontend Developer', 'Acme A/S');
    await whenIdle();
    expect(postingOf(applied).duplicate_of).toBe(primary);
    expect(postingOf(other).duplicate_of).toBe(primary);
    setTriage(applied, 'applied');

    expect(clearPreview()).toEqual({ delete: 1, keep: 2, withApplication: 1, saved: 0 });
    await clearNow();

    expect(postingIds()).toEqual([primary, applied].sort());
    expect(matchOf(primary)).toMatchObject({ state: 'scored' });
  });

  it('counts what goes, what stays, and the saved postings among those that go', async () => {
    await seed();
    expect(clearPreview()).toEqual({ delete: 3, keep: 1, withApplication: 1, saved: 1 });
  });

  it('names the backup it made in the result', async () => {
    await seed();
    const result = await clearNow();
    expect(listBackups().map((b) => b.name)).toEqual([result.backup]);
  });

  it('stores a backup with every posting before it deletes, and deletes nothing when the backup fails', async () => {
    const { fresh, saved, dismissed, applied } = await seed();
    const kept = await clearNow();
    const copy = new Database(join(backupDir(), kept.backup), { readonly: true });
    const ids = (copy.prepare('SELECT id FROM postings ORDER BY id').all() as Array<{ id: string }>).map((r) => r.id);
    copy.close();
    expect(ids).toEqual([fresh, saved, dismissed, applied].sort());

    add('remotive', 'after-1');
    await whenIdle();
    const before = postingIds();
    const file = join(mkdtempSync(join(tmpdir(), 'sieve-clear-')), 'not-a-folder');
    writeFileSync(file, '');
    setBackupDirForTests(join(file, 'backups'));

    const error = await clearNow().catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ClearError);
    expect(error).toMatchObject({
      status: 500,
      message: 'The backup could not be made, so no posting was deleted. The cause is in the Log on the Activity page.',
    });
    expect(postingIds()).toEqual(before);
  });

  it('deletes nothing and makes no backup while a fetch run is active', async () => {
    await seed();
    const before = postingIds();
    const { adapter, release } = slowSource();
    const run = startFetchRun('manual', { adapters: [adapter] })!;

    const error = await clearNow().catch((e: unknown) => e);
    release();
    await run.done;

    expect(error).toMatchObject({ status: 409, message: 'A fetch is running. Delete the postings when it ends.' });
    expect(postingIds()).toEqual(before);
    expect(listBackups()).toEqual([]);
  });

  it('deletes nothing and makes no backup when the postings changed after the user confirmed the counts', async () => {
    const { fresh } = await seed();
    const confirmed = clearPreview();
    add('remotive', 'late-1');
    await whenIdle();
    const before = postingIds();

    const added = await clearPostings(confirmed).catch((e: unknown) => e);
    setTriage(fresh, 'saved');
    const saved = await clearPostings({ ...confirmed, delete: confirmed.delete + 1 }).catch((e: unknown) => e);

    const message = 'The postings changed after the page counted them. Check the new counts and delete again.';
    expect(added).toMatchObject({ status: 409, message });
    expect(saved).toMatchObject({ status: 409, message });
    expect(postingIds()).toEqual(before);
    expect(listBackups()).toEqual([]);
  });

  it('deletes nothing when a posting is saved while the backup is written', async () => {
    const { fresh } = await seed();
    const before = postingIds();

    // The clear checks the counts, then waits for its backup. The posting is saved in that wait.
    const pending = clearNow();
    setTriage(fresh, 'saved');
    const error = await pending.catch((e: unknown) => e);

    expect(error).toMatchObject({ status: 409, message: 'The postings changed after the page counted them. Check the new counts and delete again.' });
    expect(postingIds()).toEqual(before);
    expect(postingOf(fresh).triage_status).toBe('saved');
  });

  it('refuses and makes no backup when no posting can be deleted', async () => {
    const applied = add('remotive', 'applied-only');
    await whenIdle();
    setTriage(applied, 'applied');

    const error = await clearNow().catch((e: unknown) => e);

    expect(error).toMatchObject({ status: 409, message: 'No posting can be deleted.' });
    expect(postingIds()).toEqual([applied]);
    expect(listBackups()).toEqual([]);
  });

  it('keeps the oldest backup when a fetch run starts during the backup, and prunes it after a clear goes through', async () => {
    await seed();
    setSetting('backup', { ...getSetting('backup'), keep: 2 });
    const oldest = (await createBackup()).name;
    await createBackup();
    const before = postingIds();

    // The clear checks for a run, then waits for its backup. The run starts in that wait.
    const pending = clearNow();
    const { adapter, release } = slowSource();
    const run = startFetchRun('manual', { adapters: [adapter] })!;
    const error = await pending.catch((e: unknown) => e);
    const during = listBackups().map((b) => b.name);
    release();
    await run.done;

    expect(error).toMatchObject({ status: 409, message: 'A fetch is running. Delete the postings when it ends.' });
    expect(postingIds()).toEqual(before);
    expect(during).toContain(oldest);
    expect(during).toHaveLength(3);

    const result = await clearNow();

    expect(listBackups().map((b) => b.name)).not.toContain(oldest);
    expect(listBackups()[0]!.name).toBe(result.backup);
    expect(listBackups()).toHaveLength(2);
  });

  it('reports the clear and its events when the prune of old backups fails after the delete', async () => {
    const { applied } = await seed();
    setSetting('backup', { ...getSetting('backup'), keep: 1 });
    // A folder under a backup name cannot be unlinked, so the prune fails on it.
    const stuck = join(backupDir(), 'sieve-20200101-000000.db');
    mkdirSync(stuck);
    utimesSync(stuck, new Date('2020-01-01'), new Date('2020-01-01'));
    const events: AppEvent[] = [];
    const stop = subscribe((e) => events.push(e));

    const result = await clearNow();
    stop();

    expect(result.deleted).toBe(3);
    expect(postingIds()).toEqual([applied]);
    expect(existsSync(stuck)).toBe(true);
    expect(events.map((e) => e.type)).toEqual(expect.arrayContaining(['queue.changed', 'postings.cleared']));
    const errors = sqlite.prepare(`SELECT message FROM logs WHERE level = 'error'`).all() as Array<{ message: string }>;
    expect(errors.map((r) => r.message)).toEqual([expect.stringContaining('the prune of old backups after a clear of the postings failed')]);
  });

  it('stores no facts and queues no further work when the posting is deleted while its extraction runs', async () => {
    let target = '';
    stub.facts = () => {
      // The clear runs while the model call is under way.
      sqlite.prepare('DELETE FROM matches WHERE posting_id = ?').run(target);
      sqlite.prepare('DELETE FROM postings WHERE id = ?').run(target);
      return FACTS;
    };
    target = add('remotive', 'racing-1');
    await whenIdle();

    expect(stub.calls.extract).toBe(1);
    expect(rows('posting_facts', target)).toBe(0);
    expect(tasksOf('constraints')).toEqual([]);
  });

  it('stores a deleted posting as new and unread when a source returns it again, and scores it again', async () => {
    const { dismissed } = await seed();
    await clearNow();
    const extractsBefore = stub.calls.extract;

    const again = ingestPosting(
      'remotive',
      raw({ externalId: 'dismissed-1', title: 'Developer dismissed-1', company: 'Company dismissed-1', url: 'https://jobs.test/dismissed-1' }),
    );
    await whenIdle();

    expect(again.status).toBe('new');
    const id = (again as { id: string }).id;
    expect(id).not.toBe(dismissed);
    expect(postingOf(id)).toMatchObject({ triage_status: 'new', read_at: null });
    expect(matchOf(id)).toMatchObject({ state: 'scored' });
    expect(stub.calls.extract).toBe(extractsBefore + 1);
  });
});
