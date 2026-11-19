import { z } from 'zod';
import { sqlite, parseJson } from '../kernel/db';
import { nowIso } from '../kernel/clock';
import { publish } from '../kernel/events';
import { errorMessage } from '../kernel/logger';
import { enqueue, registerHandler } from '../kernel/tasks';
import { generateWritingObject } from '../llm';
import { computeVersions, getEffectiveProfile, getPreferences, getProfile } from '../profile/service';
import { previewTotal, storeScore } from '../matching/handlers';
import type { MatchAnalysisContent, MatchAnalysisDto } from '../../shared/api';

/** The largest number of postings in one request. Each analysis is one call of the writing model. */
export const MAX_ANALYSES_PER_REQUEST = 20;

interface AnalysisRow {
  posting_id: string;
  state: 'pending' | 'ready' | 'failed';
  content_json: string | null;
  error: string | null;
  model: string | null;
  generated_at: string | null;
  updated_at: string;
}

export class MatchAnalysisError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MatchAnalysisError';
  }
}

function toDto(r: AnalysisRow): MatchAnalysisDto {
  const content = parseJson<MatchAnalysisContent | null>(r.content_json, null);
  const scores = content?.scores ?? null;
  let scoreApplied = false;
  if (scores) {
    const m = sqlite.prepare('SELECT skills_score, experience_score, preference_score FROM matches WHERE posting_id = ?').get(r.posting_id) as
      | { skills_score: number | null; experience_score: number | null; preference_score: number | null }
      | undefined;
    scoreApplied = !!m && m.skills_score === scores.skills && m.experience_score === scores.experience && m.preference_score === scores.preferences;
  }
  return {
    postingId: r.posting_id,
    state: r.state,
    content,
    error: r.error,
    model: r.model,
    generatedAt: r.generated_at,
    updatedAt: r.updated_at,
    proposedTotal: scores ? previewTotal(r.posting_id, scores) : null,
    scoreApplied,
  };
}

export function getMatchAnalysis(postingId: string): MatchAnalysisDto | null {
  const r = sqlite.prepare('SELECT * FROM match_analyses WHERE posting_id = ?').get(postingId) as AnalysisRow | undefined;
  return r ? toDto(r) : null;
}

/**
 * Starts the expanded analysis for each posting. A posting whose analysis already runs is skipped.
 * An earlier analysis stays readable until the new one is ready.
 * Returns the identifiers of the postings that were queued.
 */
export function requestMatchAnalyses(postingIds: string[]): string[] {
  const ids = [...new Set(postingIds)];
  if (ids.length > MAX_ANALYSES_PER_REQUEST) {
    throw new MatchAnalysisError(`Select at most ${MAX_ANALYSES_PER_REQUEST} postings for one analysis request.`);
  }
  const profile = getProfile();
  if (!profile.cvText && !profile.effective) throw new MatchAnalysisError('Import a CV first. The analysis compares the posting with your CV.');
  const queued: string[] = [];
  for (const id of ids) {
    if (!sqlite.prepare('SELECT id FROM postings WHERE id = ?').get(id)) continue;
    const existing = sqlite.prepare('SELECT state FROM match_analyses WHERE posting_id = ?').get(id) as { state: string } | undefined;
    if (existing?.state === 'pending') continue;
    sqlite
      .prepare(
        `INSERT INTO match_analyses (posting_id, state, updated_at) VALUES (?, 'pending', ?)
         ON CONFLICT(posting_id) DO UPDATE SET state = 'pending', error = NULL, updated_at = excluded.updated_at`,
      )
      .run(id, nowIso());
    enqueue('match_analysis', id);
    publish({ type: 'posting.updated', postingId: id });
    queued.push(id);
  }
  return queued;
}

export function requestMatchAnalysis(postingId: string): MatchAnalysisDto {
  if (!sqlite.prepare('SELECT id FROM postings WHERE id = ?').get(postingId)) throw new MatchAnalysisError('Posting not found.');
  requestMatchAnalyses([postingId]);
  return getMatchAnalysis(postingId)!;
}

export function deleteMatchAnalysis(postingId: string): boolean {
  const r = sqlite.prepare('DELETE FROM match_analyses WHERE posting_id = ?').run(postingId);
  if (r.changes > 0) publish({ type: 'posting.updated', postingId });
  return r.changes > 0;
}

/**
 * Replaces the part scores of the posting with the revised part scores of its analysis, and computes the total again.
 * A later judgment, for example after a change of the profile, replaces these part scores again.
 */
export function applyAnalysisScore(postingId: string): MatchAnalysisDto {
  const analysis = getMatchAnalysis(postingId);
  const scores = analysis?.content?.scores;
  if (!analysis || !scores) throw new MatchAnalysisError('This analysis has no scores. Run the analysis again.');
  const match = sqlite.prepare('SELECT excluded_reason FROM matches WHERE posting_id = ?').get(postingId) as { excluded_reason: string | null } | undefined;
  if (!match) throw new MatchAnalysisError('The posting has no score yet. Wait until the scoring is done.');
  if (match.excluded_reason) throw new MatchAnalysisError(`A rule excludes this posting, so it has no score: ${match.excluded_reason}`);
  const profile = getEffectiveProfile();
  if (!profile) throw new MatchAnalysisError('Import a CV first.');
  const { judgeVersion } = computeVersions(profile, getPreferences());
  sqlite
    .prepare(
      `UPDATE matches SET skills_score = ?, experience_score = ?, preference_score = ?, assessment = ?, judge_version = ?,
         provider = 'expanded analysis', model = ?, updated_at = ? WHERE posting_id = ?`,
    )
    .run(scores.skills, scores.experience, scores.preferences, analysis.content!.summary, judgeVersion, analysis.model, nowIso(), postingId);
  if (storeScore(postingId, true) === null) throw new MatchAnalysisError('The score could not be computed. The posting may lack extracted facts.');
  return getMatchAnalysis(postingId)!;
}

/** Call once at startup. An analysis that ran when the process stopped is queued again. */
export function recoverPendingAnalyses(): void {
  const rows = sqlite.prepare(`SELECT posting_id FROM match_analyses WHERE state = 'pending'`).all() as Array<{ posting_id: string }>;
  for (const r of rows) enqueue('match_analysis', r.posting_id);
}

const text = (max: number) => z.string().trim().min(1).max(max);

export const AnalysisOutput = z.object({
  verdict: z.enum(['apply', 'consider', 'skip']),
  summary: text(1200),
  strengths: z.array(z.object({ point: text(300), evidence: text(600) })).max(8),
  gaps: z.array(z.object({ point: text(300), severity: z.enum(['blocking', 'significant', 'minor']), mitigation: text(600) })).max(8),
  unknowns: z.array(text(400)).max(8),
  positioning: z.array(text(500)).max(6),
  scores: z.object({
    skills: z.number().int().min(0).max(100),
    experience: z.number().int().min(0).max(100),
    preferences: z.number().int().min(0).max(100),
  }),
});

const SYSTEM = `You analyze how well one candidate fits one job posting. The candidate reads your analysis to decide whether to apply. You get the job posting, the candidate's CV, the candidate's structured profile, the candidate's preferences, and the score that a faster system already gave.
Rules:
- Write in English, also when the posting is in another language.
- Use only facts from the CV, the profile, the preferences, and the posting. Never invent an employer, a skill, a number, a requirement, or a date.
- "verdict": "apply" when the candidate meets the main requirements and the role fits the preferences. "consider" when the fit depends on a gap or an unknown that the candidate can judge. "skip" when a blocking gap or a clear conflict with the preferences exists.
- "summary": three to five sentences. State the verdict and the two or three facts that decide it. Address the candidate as "you".
- "strengths": requirements of the posting that the CV shows. In "evidence", name the role, project, or number in the CV that shows it.
- "gaps": requirements of the posting that the CV does not show, and conflicts with the preferences. "blocking" means the posting states it as required and the CV shows nothing close. "significant" means it is important and only partly shown. "minor" means it is a wish of the posting or easy to learn. In "mitigation", say what the candidate can truthfully do or say about it. Say so when nothing helps.
- "unknowns": what the posting does not state and the candidate needs to know, as questions to ask the employer. Examples: salary, remote policy, team size, language at work.
- "positioning": what to emphasize in an application for this role, each item tied to a fact from the CV.
- "scores": your own part scores from 0 to 100, on the same scale as the earlier score. "skills": how well the candidate's skills cover the required skills, optional skills count less. "experience": how well the years, roles, and seniority fit. "preferences": how well the job fits the stated preferences, 70 when they say nothing relevant. Do not score location, spoken language, or work arrangement. Other code handles those.
- You may disagree with the earlier score. Say so in the summary when you do, and give the reason.
- Be direct and specific. No flattery, no generic career advice, no clichés. An empty list is correct when nothing belongs in it.`;

interface Source {
  title: string;
  company: string;
  location: string | null;
  description: string | null;
  facts_json: string | null;
  snapshot_json: string | null;
  m_state: string | null;
  total_score: number | null;
  skills_score: number | null;
  experience_score: number | null;
  preference_score: number | null;
  location_score: number | null;
  assessment: string | null;
  excluded_reason: string | null;
}

export function registerMatchAnalysisHandler(): void {
  registerHandler('match_analysis', async (ctx) => {
    const postingId = ctx.subjectId;
    const row = sqlite.prepare('SELECT * FROM match_analyses WHERE posting_id = ?').get(postingId) as AnalysisRow | undefined;
    if (!row || row.state !== 'pending') return;
    const fail = (message: string) => {
      sqlite
        .prepare(`UPDATE match_analyses SET state = ?, error = ?, updated_at = ? WHERE posting_id = ?`)
        .run(row.content_json ? 'ready' : 'failed', message, nowIso(), postingId);
      publish({ type: 'posting.updated', postingId });
    };
    const src = sqlite
      .prepare(
        `SELECT p.title, p.company, p.location, p.description, f.facts_json, a.snapshot_json,
                m.state AS m_state, m.total_score, m.skills_score, m.experience_score, m.preference_score, m.location_score, m.assessment, m.excluded_reason
         FROM postings p
         LEFT JOIN posting_facts f ON f.posting_id = p.id
         LEFT JOIN applications a ON a.posting_id = p.id
         LEFT JOIN matches m ON m.posting_id = p.id WHERE p.id = ?`,
      )
      .get(postingId) as Source | undefined;
    if (!src) return fail('The posting no longer exists.');
    const profile = getProfile();
    // The copy in the application keeps the description when the board removed the posting.
    const snapshot = parseJson<{ description?: string | null } | null>(src.snapshot_json, null);
    const description = src.description ?? snapshot?.description ?? null;
    const earlier =
      src.m_state === 'scored'
        ? JSON.stringify({
            total: src.total_score,
            skills: src.skills_score,
            experience: src.experience_score,
            preferences: src.preference_score,
            location: src.location_score,
            assessment: src.assessment,
          })
        : src.m_state === 'excluded'
          ? `Excluded by a rule of the candidate: ${src.excluded_reason ?? 'no reason stored'}`
          : 'No score exists yet.';
    const user = [
      `JOB POSTING\nTitle: ${src.title}\nCompany: ${src.company}\nLocation: ${src.location ?? 'not stated'}`,
      src.facts_json ? `Extracted facts (JSON): ${src.facts_json}` : '',
      `Description:\n${description ? description.slice(0, 12_000) : 'No description is available.'}`,
      `CANDIDATE CV\n${profile.cvText ? profile.cvText.slice(0, 24_000) : 'No CV text is available. Use the structured profile.'}`,
      profile.effective ? `STRUCTURED PROFILE (JSON, with the candidate's own corrections)\n${JSON.stringify(profile.effective)}` : '',
      `CANDIDATE PREFERENCES (JSON)\n${JSON.stringify(getPreferences())}`,
      `EARLIER SCORE (0 to 100 for each part)\n${earlier}`,
    ]
      .filter(Boolean)
      .join('\n\n');
    try {
      const { data, model } = await generateWritingObject(
        AnalysisOutput,
        [
          { role: 'system', content: SYSTEM },
          { role: 'user', content: user },
        ],
        { name: 'match_analysis' },
      );
      const now = nowIso();
      sqlite
        .prepare(`UPDATE match_analyses SET state = 'ready', content_json = ?, error = NULL, model = ?, generated_at = ?, updated_at = ? WHERE posting_id = ?`)
        .run(JSON.stringify(data), model, now, now, postingId);
      publish({ type: 'posting.updated', postingId });
    } catch (err) {
      // The task does not retry. The user sees the cause and starts the analysis again.
      fail(errorMessage(err));
    }
  });
}
