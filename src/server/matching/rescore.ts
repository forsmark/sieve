import { sqlite } from '../kernel/db';
import { enqueue } from '../kernel/tasks';
import { enqueuePipeline, priorityFor, needsEnrichment } from '../ingestion/ingest';
import { sha } from '../ingestion/normalize';
import { computeVersions, currentVersions, getEffectiveProfile } from '../profile/service';
import type { Preferences } from '../../shared/schemas';

export interface RescorePlan {
  /** Postings that need only the code steps. No model call. */
  rulesOnly: number;
  /** Postings that need a new judgment. One model call each. */
  judge: number;
  /** Postings that need extraction first. Two model calls each. */
  extract: number;
}

interface Row {
  id: string;
  description: string | null;
  posted_at: string | null;
  first_seen_at: string;
  lacks_description: number;
  description_hash: string | null;
  state: string | null;
  judge_version: string | null;
  rule_version: string | null;
  skills_score: number | null;
}

/**
 * Queues the least work for each primary posting whose match is out of date.
 * - Changed rules or weights: constraints and score, both in code.
 * - Changed judge input: judge and score. The extracted facts are reused.
 * - Missing facts or a changed description: the full pipeline.
 * Returns the plan, so the caller can tell the user what the change costs.
 * A plan for preferences that are not stored is always a dry run.
 */
export function planRescore(opts: { dryRun?: boolean; preferences?: Preferences } = {}): RescorePlan {
  const plan: RescorePlan = { rulesOnly: 0, judge: 0, extract: 0 };
  // With `preferences`, the plan shows what a change would cost before the user saves it.
  const profile = getEffectiveProfile();
  const versions = opts.preferences ? (profile ? computeVersions(profile, opts.preferences) : null) : currentVersions();
  if (!versions) return plan;
  const dryRun = opts.dryRun === true || opts.preferences !== undefined;
  const rows = sqlite
    .prepare(
      `SELECT p.id, p.description, p.posted_at, p.first_seen_at, p.lacks_description,
              f.description_hash, m.state, m.judge_version, m.rule_version, m.skills_score
       FROM postings p
       LEFT JOIN posting_facts f ON f.posting_id = p.id
       LEFT JOIN matches m ON m.posting_id = p.id
       WHERE p.duplicate_of IS NULL`,
    )
    .all() as Row[];

  for (const r of rows) {
    const priority = priorityFor(r.posted_at, r.first_seen_at);
    const factsMissing = r.description_hash === null;
    const descriptionChanged = !factsMissing && r.description_hash !== sha(r.description ?? '');
    if (factsMissing || descriptionChanged) {
      plan.extract++;
      if (!dryRun) enqueuePipeline(r);
      continue;
    }
    if (r.state === 'failed') continue;
    const ruleStale = r.rule_version !== versions.ruleVersion;
    const judgeStale = r.judge_version !== versions.judgeVersion || r.skills_score === null;
    if (ruleStale) {
      // The constraints step decides whether a judge call is still needed.
      if (judgeStale) plan.judge++;
      else plan.rulesOnly++;
      if (!dryRun) enqueue('constraints', r.id, { priority });
    } else if (judgeStale && r.state !== 'excluded') {
      plan.judge++;
      if (!dryRun) enqueue('judge', r.id, { priority });
    }
  }
  return plan;
}

/** The user asks for a full new judgment of selected postings. Extracted facts are reused. No automatic dismissal follows. */
export function rescorePostings(ids: string[]): number {
  let queued = 0;
  for (const id of ids) {
    const row = sqlite
      .prepare(
        `SELECT p.id, p.description, p.posted_at, p.first_seen_at, p.lacks_description, f.posting_id AS has_facts
         FROM postings p LEFT JOIN posting_facts f ON f.posting_id = p.id WHERE p.id = ? AND p.duplicate_of IS NULL`,
      )
      .get(id) as (Row & { has_facts: string | null }) | undefined;
    if (!row) continue;
    const priority = priorityFor(row.posted_at, row.first_seen_at) + 1_000_000_000;
    sqlite.prepare(`UPDATE matches SET state = CASE WHEN state = 'failed' THEN 'waiting' ELSE state END WHERE posting_id = ?`).run(id);
    // A posting that still has only the teaser of its source gets the full description first.
    const kind = needsEnrichment(row) ? 'enrich' : row.has_facts ? 'constraints' : 'extract';
    if (enqueue(kind, id, { priority, payload: { manual: true } })) queued++;
  }
  return queued;
}
