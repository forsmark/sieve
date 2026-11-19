import { randomUUID } from 'node:crypto';
import { sqlite } from '../kernel/db';
import { nowIso } from '../kernel/clock';
import { publish } from '../kernel/events';
import { enqueue } from '../kernel/tasks';
import type { RawPosting } from '../sources/adapter';
import { getAdapter } from '../sources/registry';
import { isSimilarTitle, normalizePosting } from './normalize';

export type IngestResult =
  | { status: 'invalid' }
  | { status: 'existing'; id: string }
  | { status: 'duplicate'; id: string; duplicateOf: string }
  | { status: 'new'; id: string };

/** A description shorter than this is treated as missing, and the enrich task fetches the page. */
export const MIN_DESCRIPTION_LENGTH = 200;

/** Newer postings get a higher task priority, so the queue takes them first. */
export function priorityFor(postedAt: string | null, firstSeenAt: string): number {
  return Math.floor(new Date(postedAt ?? firstSeenAt).getTime() / 1000);
}

/** Enqueues the first pipeline step for a primary posting. */
export function enqueuePipeline(posting: { id: string; description: string | null; posted_at: string | null; first_seen_at: string; lacks_description?: number }): void {
  const priority = priorityFor(posting.posted_at, posting.first_seen_at);
  if (needsEnrichment(posting)) enqueue('enrich', posting.id, { priority });
  else enqueue('extract', posting.id, { priority });
}

/**
 * True when the enrich task must fetch the description first: the description is short, or the source
 * gives only a teaser and the full text was never fetched.
 */
export function needsEnrichment(posting: { id: string; description: string | null; lacks_description?: number }): boolean {
  if (posting.lacks_description) return false;
  if (!posting.description || posting.description.length < MIN_DESCRIPTION_LENGTH) return true;
  const row = sqlite.prepare('SELECT source, enriched_at FROM postings WHERE id = ?').get(posting.id) as { source: string; enriched_at: string | null } | undefined;
  return !!row && row.enriched_at === null && getAdapter(row.source)?.teaserOnly === true;
}

function findDuplicate(source: string, externalId: string, fp: string, companyKey: string, title: string): string | null {
  const exact = sqlite
    .prepare(
      `SELECT id FROM postings WHERE fingerprint = ? AND duplicate_of IS NULL
       AND NOT (source = ? AND external_id = ?) ORDER BY first_seen_at ASC LIMIT 1`,
    )
    .get(fp, source, externalId) as { id: string } | undefined;
  if (exact) return exact.id;
  if (!companyKey) return null;
  const candidates = sqlite
    .prepare(
      `SELECT id, title FROM postings WHERE company_key = ? AND duplicate_of IS NULL
       AND NOT (source = ? AND external_id = ?) ORDER BY first_seen_at ASC`,
    )
    .all(companyKey, source, externalId) as Array<{ id: string; title: string }>;
  for (const c of candidates) if (isSimilarTitle(title, c.title)) return c.id;
  return null;
}

/**
 * Stores one raw posting from a source.
 * - A posting that already exists keeps its status, score, and first-seen time.
 * - A posting that describes the same job as an earlier one becomes a duplicate and gets no match.
 * - A new primary posting gets a match row in the state "waiting" and enters the pipeline.
 */
export function ingestPosting(source: string, raw: RawPosting): IngestResult {
  const n = normalizePosting(raw);
  if (!n) return { status: 'invalid' };

  const result = sqlite.transaction((): IngestResult => {
    const existing = sqlite
      .prepare('SELECT id, description, duplicate_of, posted_at, first_seen_at FROM postings WHERE source = ? AND external_id = ?')
      .get(source, n.externalId) as
      | { id: string; description: string | null; duplicate_of: string | null; posted_at: string | null; first_seen_at: string }
      | undefined;

    if (existing) {
      const gainsDescription =
        n.description !== null &&
        n.description.length >= MIN_DESCRIPTION_LENGTH &&
        (existing.description === null || existing.description.length < MIN_DESCRIPTION_LENGTH);
      if (gainsDescription) {
        sqlite.prepare('UPDATE postings SET description = ?, lacks_description = 0 WHERE id = ?').run(n.description, existing.id);
        if (!existing.duplicate_of) {
          enqueue('extract', existing.id, { priority: priorityFor(existing.posted_at, existing.first_seen_at) });
        }
      }
      return { status: 'existing', id: existing.id };
    }

    const id = randomUUID();
    const firstSeenAt = nowIso();
    const duplicateOf = findDuplicate(source, n.externalId, n.fingerprint, n.companyKey, n.title);
    sqlite
      .prepare(
        `INSERT INTO postings (id, source, external_id, title, company, location, url, description, posted_at,
           first_seen_at, company_key, fingerprint, duplicate_of)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(id, source, n.externalId, n.title, n.company, n.location, n.url, n.description, n.postedAt, firstSeenAt, n.companyKey, n.fingerprint, duplicateOf);

    if (duplicateOf) return { status: 'duplicate', id, duplicateOf };

    sqlite.prepare(`INSERT INTO matches (posting_id, state, updated_at) VALUES (?, 'waiting', ?)`).run(id, firstSeenAt);
    enqueuePipeline({ id, description: n.description, posted_at: n.postedAt, first_seen_at: firstSeenAt });
    return { status: 'new', id };
  })();

  if (result.status === 'new') publish({ type: 'posting.added', postingId: result.id });
  if (result.status === 'duplicate') publish({ type: 'posting.updated', postingId: result.duplicateOf });
  return result;
}

/** The user says that a posting is not a duplicate. It becomes a primary record and gets scored. */
export function separateDuplicate(id: string): boolean {
  const row = sqlite
    .prepare('SELECT id, description, posted_at, first_seen_at, duplicate_of, lacks_description FROM postings WHERE id = ?')
    .get(id) as
    | { id: string; description: string | null; posted_at: string | null; first_seen_at: string; duplicate_of: string | null; lacks_description: number }
    | undefined;
  if (!row || !row.duplicate_of) return false;
  sqlite.transaction(() => {
    sqlite.prepare('UPDATE postings SET duplicate_of = NULL, duplicate_locked = 1 WHERE id = ?').run(id);
    sqlite.prepare(`INSERT OR IGNORE INTO matches (posting_id, state, updated_at) VALUES (?, 'waiting', ?)`).run(id, nowIso());
    enqueuePipeline(row);
  })();
  publish({ type: 'posting.added', postingId: id });
  publish({ type: 'posting.updated', postingId: row.duplicate_of });
  return true;
}
