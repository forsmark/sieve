import { sqlite, parseJson } from '../kernel/db';
import { nowIso } from '../kernel/clock';
import { publish } from '../kernel/events';
import { errorMessage } from '../kernel/logger';
import { enqueue, LaneUnavailableError, registerHandler, type TaskContext } from '../kernel/tasks';
import { generateObject } from '../llm';
import { sha } from '../ingestion/normalize';
import { priorityFor } from '../ingestion/ingest';
import { Judgment, PostingFacts } from '../../shared/schemas';
import { computeVersions, getEffectiveProfile, getPreferences, judgeInput } from '../profile/service';
import { queueNotification } from '../notifications/service';
import { evaluateConstraints, locationScore, totalScore, type SoftViolation } from './rules';

interface PostingRow {
  id: string;
  title: string;
  company: string;
  location: string | null;
  description: string | null;
  posted_at: string | null;
  first_seen_at: string;
  duplicate_of: string | null;
  triage_status: string;
  lacks_description: number;
}

interface MatchRow {
  posting_id: string;
  state: string;
  judge_version: string | null;
  rule_version: string | null;
  excluded_reason: string | null;
  soft_violations: string;
  skills_score: number | null;
  experience_score: number | null;
  preference_score: number | null;
  first_scored_at: string | null;
}

function getPosting(id: string): PostingRow | undefined {
  return sqlite.prepare('SELECT * FROM postings WHERE id = ?').get(id) as PostingRow | undefined;
}

function getMatch(id: string): MatchRow | undefined {
  return sqlite.prepare('SELECT * FROM matches WHERE posting_id = ?').get(id) as MatchRow | undefined;
}

export function getFacts(id: string): PostingFacts | null {
  const row = sqlite.prepare('SELECT facts_json FROM posting_facts WHERE posting_id = ?').get(id) as { facts_json: string } | undefined;
  return row ? parseJson<PostingFacts | null>(row.facts_json, null) : null;
}

function setState(id: string, state: string, failReason: string | null = null): void {
  sqlite.prepare('UPDATE matches SET state = ?, fail_reason = ?, updated_at = ? WHERE posting_id = ?').run(state, failReason, nowIso(), id);
  publish({ type: 'match.updated', postingId: id });
}

/** Marks the posting as failed when the task used its last attempt. The queue then continues with the next posting. */
function failOnLastAttempt(ctx: TaskContext, err: unknown): never {
  if (!(err instanceof LaneUnavailableError)) {
    if (ctx.isLastAttempt) setState(ctx.subjectId, 'failed', errorMessage(err));
    else setState(ctx.subjectId, 'waiting');
  } else {
    setState(ctx.subjectId, 'waiting');
  }
  throw err;
}

const EXTRACT_SYSTEM = `You extract facts from one job posting.
Rules:
- Use only what the posting states. When the posting does not state a fact, use null or an empty list. Do not guess.
- requiredSkills: technologies, tools, and methods that the posting requires. optionalSkills: those that it calls a plus or nice to have. Use short canonical names such as "TypeScript", "React", "AWS". At most 12 each.
- seniority: junior, mid, senior, or lead, or null.
- workArrangement: remote, hybrid, or onsite, or null when the posting does not say.
- location: city and country of the workplace in English, for example city "Copenhagen", country "Denmark". Null when not stated.
- requiredLanguages: spoken languages that the job requires, in English, for example "Danish". Do not list a language only because the posting is written in it, unless the posting says the language is required.
- salary: only when the posting states numbers. period is "year", "month", or "hour".
- summary: two or three factual sentences about the role. No opinion.`;

const JUDGE_SYSTEM = `You judge how well one job fits one candidate. You get extracted job facts, the candidate profile, and the candidate's preferences as JSON.
Score each dimension from 0 to 100:
- skillsFit: how well the candidate's skills cover the required skills. Optional skills count less.
- experienceFit: how well the candidate's years, roles, and seniority fit the role.
- preferenceFit: how well the job fits the stated preferences: target seniority, minimum salary, wanted and unwanted technologies, and notes. Use 70 when the preferences say nothing relevant.
Do not judge location, spoken language, or work arrangement. Other code handles those.
matchedSkills: required or optional skills of the job that the candidate has. missingSkills: required skills that the candidate lacks.
assessment: two sentences addressed to the candidate with "you". State the main reason for and the main reason against.`;

async function handleExtract(ctx: TaskContext): Promise<void> {
  const posting = getPosting(ctx.subjectId);
  if (!posting || posting.duplicate_of) return;
  const description = posting.description ?? '';
  const descriptionHash = sha(description);
  setState(posting.id, 'in_progress');
  try {
    const { data, provider, model } = await generateObject(
      PostingFacts,
      [
        { role: 'system', content: EXTRACT_SYSTEM },
        {
          role: 'user',
          content: `Title: ${posting.title}\nCompany: ${posting.company}\nLocation: ${posting.location ?? 'not stated'}\n\nDescription:\n${description ? description.slice(0, 8000) : 'No description is available. Use the title, company, and location only.'}`,
        },
      ],
      { name: 'posting_facts' },
    );
    // The posting can be deleted while the model call runs, by a clear of the postings. Then nothing is stored.
    const stored = sqlite
      .prepare(
        `INSERT INTO posting_facts (posting_id, facts_json, description_hash, provider, model, created_at)
         SELECT ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM postings WHERE id = ?)
         ON CONFLICT(posting_id) DO UPDATE SET facts_json = excluded.facts_json, description_hash = excluded.description_hash,
           provider = excluded.provider, model = excluded.model, created_at = excluded.created_at`,
      )
      .run(posting.id, JSON.stringify(data), descriptionHash, provider, model, nowIso(), posting.id).changes;
    if (stored === 0) return;
    // New facts make an earlier judgment invalid.
    sqlite.prepare('UPDATE matches SET judge_version = NULL, rule_version = NULL WHERE posting_id = ?').run(posting.id);
    setState(posting.id, 'waiting');
    enqueue('constraints', posting.id, { priority: priorityFor(posting.posted_at, posting.first_seen_at), payload: ctx.payload });
  } catch (err) {
    failOnLastAttempt(ctx, err);
  }
}

async function handleConstraints(ctx: TaskContext): Promise<void> {
  const posting = getPosting(ctx.subjectId);
  if (!posting || posting.duplicate_of) return;
  const facts = getFacts(posting.id);
  const profile = getEffectiveProfile();
  // Without a profile the posting stays unscored. The planner queues it again when a profile exists.
  if (!facts || !profile) return;
  const prefs = getPreferences();
  const versions = computeVersions(profile, prefs);
  const result = evaluateConstraints(posting, facts, profile, prefs);
  const match = getMatch(posting.id);

  sqlite
    .prepare('UPDATE matches SET excluded_reason = ?, soft_violations = ?, rule_version = ?, updated_at = ? WHERE posting_id = ?')
    .run(result.excludedReason, JSON.stringify(result.softViolations), versions.ruleVersion, nowIso(), posting.id);

  if (result.excludedReason) {
    sqlite.prepare('UPDATE matches SET total_score = NULL WHERE posting_id = ?').run(posting.id);
    setState(posting.id, 'excluded');
    return;
  }
  const priority = priorityFor(posting.posted_at, posting.first_seen_at);
  const hasCurrentJudgment = match?.skills_score != null && match.judge_version === versions.judgeVersion;
  if (hasCurrentJudgment && !ctx.payload.manual) enqueue('score', posting.id, { priority, payload: ctx.payload });
  else enqueue('judge', posting.id, { priority, payload: ctx.payload });
  if (match?.state === 'excluded') setState(posting.id, 'waiting');
}

async function handleJudge(ctx: TaskContext): Promise<void> {
  const posting = getPosting(ctx.subjectId);
  if (!posting || posting.duplicate_of) return;
  const facts = getFacts(posting.id);
  const profile = getEffectiveProfile();
  if (!facts || !profile) return;
  const prefs = getPreferences();
  const versions = computeVersions(profile, prefs);
  const match = getMatch(posting.id);
  if (match?.excluded_reason) return;
  const wasScored = match?.state === 'scored';
  if (!wasScored) setState(posting.id, 'in_progress');
  try {
    const { data, provider, model } = await generateObject(
      Judgment,
      [
        { role: 'system', content: JUDGE_SYSTEM },
        {
          role: 'user',
          content: JSON.stringify({ job: { title: posting.title, company: posting.company, ...facts }, ...judgeInput(profile, prefs) }),
        },
      ],
      { name: 'judgment' },
    );
    sqlite
      .prepare(
        `UPDATE matches SET skills_score = ?, experience_score = ?, preference_score = ?, matched_skills = ?, missing_skills = ?,
           assessment = ?, judge_version = ?, provider = ?, model = ?, updated_at = ? WHERE posting_id = ?`,
      )
      .run(
        data.skillsFit, data.experienceFit, data.preferenceFit, JSON.stringify(data.matchedSkills), JSON.stringify(data.missingSkills),
        data.assessment, versions.judgeVersion, provider, model, nowIso(), posting.id,
      );
    // The score step can wait, for example while matching is paused. The posting then shows "waiting".
    if (!wasScored) setState(posting.id, 'waiting');
    enqueue('score', posting.id, { priority: priorityFor(posting.posted_at, posting.first_seen_at), payload: ctx.payload });
  } catch (err) {
    // A stale score stays visible while the new judgment waits or retries.
    if (wasScored && (err instanceof LaneUnavailableError || !ctx.isLastAttempt)) throw err;
    failOnLastAttempt(ctx, err);
  }
}

/** The total that the given part scores give for a posting under the current rules. Null when no total can be computed. */
export function previewTotal(postingId: string, parts: { skills: number; experience: number; preferences: number }): number | null {
  const facts = getFacts(postingId);
  const match = getMatch(postingId);
  if (!facts || !match || match.excluded_reason) return null;
  const prefs = getPreferences();
  return totalScore({ ...parts, location: locationScore(facts, prefs) }, prefs.weights, parseJson<SoftViolation[]>(match.soft_violations, []));
}

/**
 * Computes the total from the stored part scores and stores it. Returns the total, or null when the posting cannot be scored.
 * `manual` is true when the user caused the score. Automatic dismissal then does not apply.
 */
export function storeScore(postingId: string, manual: boolean): number | null {
  const posting = getPosting(postingId);
  if (!posting || posting.duplicate_of) return null;
  const facts = getFacts(posting.id);
  const profile = getEffectiveProfile();
  const match = getMatch(posting.id);
  if (!facts || !profile || !match || match.excluded_reason) return null;
  if (match.skills_score == null || match.experience_score == null || match.preference_score == null) return null;
  const prefs = getPreferences();
  const versions = computeVersions(profile, prefs);
  const location = locationScore(facts, prefs);
  const soft = parseJson<SoftViolation[]>(match.soft_violations, []);
  const total = totalScore(
    { skills: match.skills_score, experience: match.experience_score, preferences: match.preference_score, location },
    prefs.weights,
    soft,
  );
  const isFirstScore = match.first_scored_at === null;
  const now = nowIso();
  sqlite
    .prepare(
      `UPDATE matches SET location_score = ?, total_score = ?, rule_version = ?, state = 'scored', fail_reason = NULL,
         first_scored_at = COALESCE(first_scored_at, ?), updated_at = ? WHERE posting_id = ?`,
    )
    .run(location, total, versions.ruleVersion, now, now, posting.id);

  // Automatic dismissal applies only to the first score of a posting that the user has not triaged.
  if (isFirstScore && !manual && prefs.autoDismiss.enabled && total < prefs.autoDismiss.threshold && posting.triage_status === 'new') {
    sqlite.prepare(`UPDATE postings SET triage_status = 'dismissed', triage_origin = 'auto' WHERE id = ? AND triage_status = 'new'`).run(posting.id);
  }
  if (isFirstScore) queueNotification(posting.id, total);
  publish({ type: 'match.updated', postingId: posting.id });
  return total;
}

async function handleScore(ctx: TaskContext<{ manual?: boolean }>): Promise<void> {
  storeScore(ctx.subjectId, !!ctx.payload.manual);
}

export function registerMatchingHandlers(): void {
  registerHandler('extract', handleExtract);
  registerHandler('constraints', handleConstraints);
  registerHandler('judge', handleJudge);
  registerHandler('score', handleScore);
}
