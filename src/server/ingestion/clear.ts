import { sqlite } from '../kernel/db';
import { publish } from '../kernel/events';
import { errorMessage, log } from '../kernel/logger';
import { createBackup, pruneBackups } from '../http/backup';
import { getActiveRunId } from '../sources/runner';
import type { ClearPreviewDto, ClearResultDto } from '../../shared/api';

/** The task kinds whose subject is a posting id. `notify` and `derive_profile` have other subjects. */
const POSTING_TASK_KINDS = ['enrich', 'extract', 'constraints', 'judge', 'score', 'liveness', 'cover_letter', 'match_analysis'] as const;

/** Tables keyed by the posting id, apart from `postings` and the application tables. */
const POSTING_TABLES = ['posting_facts', 'matches', 'cover_letters', 'match_analyses'] as const;

/**
 * The postings a clear keeps: each posting with an application, and the primary record of each such posting that is a
 * duplicate, so that `duplicate_of` never points to a missing row. The query returns no null, which `NOT IN` needs.
 */
const KEEP_SQL = `SELECT posting_id FROM applications
  UNION SELECT p.duplicate_of FROM postings p JOIN applications a ON a.posting_id = p.id WHERE p.duplicate_of IS NOT NULL`;

export class ClearError extends Error {
  constructor(
    message: string,
    readonly status: 409 | 500,
  ) {
    super(message);
    this.name = 'ClearError';
  }
}

const RUN_ACTIVE = 'A fetch is running. Delete the postings when it ends.';
const COUNTS_CHANGED = 'The postings changed after the page counted them. Check the new counts and delete again.';
const NOTHING = 'No posting can be deleted.';

function count(sql: string): number {
  return (sqlite.prepare(sql).get() as { n: number }).n;
}

/** How many postings a clear deletes and keeps now, how many of the kept ones have an application, and how many of the deleted ones are saved. */
export function clearPreview(): ClearPreviewDto {
  const keep = count(`SELECT COUNT(*) AS n FROM postings WHERE id IN (${KEEP_SQL})`);
  const withApplication = count('SELECT COUNT(*) AS n FROM postings WHERE id IN (SELECT posting_id FROM applications)');
  const total = count('SELECT COUNT(*) AS n FROM postings');
  const saved = count(`SELECT COUNT(*) AS n FROM postings WHERE triage_status = 'saved' AND id NOT IN (${KEEP_SQL})`);
  return { delete: total - keep, keep, withApplication, saved };
}

/** Refuses when nothing can be deleted, or when the counts differ from the ones the user confirmed. */
function checkCounts(confirmed: ConfirmedCounts): void {
  const now = clearPreview();
  if (now.delete === 0) throw new ClearError(NOTHING, 409);
  if (now.delete !== confirmed.delete || now.saved !== confirmed.saved) throw new ClearError(COUNTS_CHANGED, 409);
}

/** The counts the user confirmed. The clear goes ahead only while they still hold. */
export interface ConfirmedCounts {
  delete: number;
  saved: number;
}

/**
 * Deletes every posting that a clear does not keep, with the rows and the tasks that refer to it.
 * It refuses while a fetch run is active, and when the counts differ from the ones the user confirmed, before the backup
 * and again right before the delete.
 * It makes a backup first and deletes nothing when the backup fails. Older backups are pruned only after the delete.
 */
export async function clearPostings(confirmed: ConfirmedCounts): Promise<ClearResultDto> {
  if (getActiveRunId() !== null) throw new ClearError(RUN_ACTIVE, 409);
  checkCounts(confirmed);
  let backup: string;
  try {
    // A refusal after the backup must not cost the oldest backup, so the prune waits for the delete.
    backup = (await createBackup({ prune: false })).name;
  } catch (err) {
    log('error', `the backup before a clear of the postings failed, so nothing was deleted: ${errorMessage(err)}`);
    throw new ClearError('The backup could not be made, so no posting was deleted. The cause is in the Log on the Activity page.', 500);
  }
  // A scheduled run can start while the backup is written.
  if (getActiveRunId() !== null) throw new ClearError(RUN_ACTIVE, 409);

  const marks = POSTING_TASK_KINDS.map(() => '?').join(', ');
  const { deleted, kept } = sqlite.transaction(() => {
    // A posting can be saved or added while the backup is written, so the counts are checked again where nothing else writes.
    checkCounts(confirmed);
    sqlite.exec('DROP TABLE IF EXISTS temp.clear_keep');
    sqlite.exec('CREATE TEMP TABLE clear_keep (id TEXT PRIMARY KEY)');
    sqlite.prepare(`INSERT OR IGNORE INTO clear_keep (id) ${KEEP_SQL}`).run();
    for (const table of POSTING_TABLES) sqlite.prepare(`DELETE FROM ${table} WHERE posting_id NOT IN (SELECT id FROM clear_keep)`).run();
    sqlite.prepare(`DELETE FROM tasks WHERE kind IN (${marks}) AND subject_id NOT IN (SELECT id FROM clear_keep)`).run(...POSTING_TASK_KINDS);
    const removed = sqlite.prepare('DELETE FROM postings WHERE id NOT IN (SELECT id FROM clear_keep)').run().changes;
    sqlite.exec('DROP TABLE temp.clear_keep');
    return { deleted: removed, kept: count('SELECT COUNT(*) AS n FROM postings') };
  })();

  try {
    pruneBackups();
  } catch (err) {
    // The postings are gone at this point, so the clear still reports success and only the prune is logged.
    log('error', `the prune of old backups after a clear of the postings failed: ${errorMessage(err)}`);
  }
  log('info', `cleared ${deleted} postings and kept ${kept}; backup ${backup} holds the earlier data`);
  publish({ type: 'queue.changed' });
  publish({ type: 'postings.cleared' });
  return { deleted, kept, backup };
}
