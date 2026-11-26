import { sqlite, parseJson } from '../kernel/db';
import { isoAfter, nowIso } from '../kernel/clock';
import { publish } from '../kernel/events';
import { createApplication, getApplication, removeApplication } from '../applications/service';
import { getCoverLetter } from '../letters/service';
import { getMatchAnalysis } from '../analysis/service';
import { currentVersions, type Versions } from '../profile/service';
import type {
  AnalysisVerdict,
  MatchDetail,
  PostingCounts,
  PostingDetail,
  PostingListItem,
  PostingListResponse,
  PostingQuery,
  SoftViolationView,
  TriageAction,
  TriageResult,
} from '../../shared/api';
import type { LinkStatus, MatchState, PostingFacts, TriageStatus } from '../../shared/schemas';

interface JoinedRow {
  id: string;
  source: string;
  title: string;
  company: string;
  location: string | null;
  url: string;
  description: string | null;
  lacks_description: number;
  posted_at: string | null;
  first_seen_at: string;
  duplicate_of: string | null;
  link_status: string;
  triage_status: string;
  triage_origin: string | null;
  read_at: string | null;
  facts_json: string | null;
  m_state: string | null;
  fail_reason: string | null;
  judge_version: string | null;
  rule_version: string | null;
  excluded_reason: string | null;
  soft_violations: string | null;
  skills_score: number | null;
  experience_score: number | null;
  preference_score: number | null;
  location_score: number | null;
  total_score: number | null;
  matched_skills: string | null;
  missing_skills: string | null;
  assessment: string | null;
  provider: string | null;
  model: string | null;
  dup_sources: string | null;
  an_state: string | null;
  an_verdict: string | null;
}

const SELECT = `
  SELECT p.*, f.facts_json,
         m.state AS m_state, m.fail_reason, m.judge_version, m.rule_version, m.excluded_reason, m.soft_violations,
         m.skills_score, m.experience_score, m.preference_score, m.location_score, m.total_score,
         m.matched_skills, m.missing_skills, m.assessment, m.provider, m.model,
         (SELECT group_concat(DISTINCT d.source) FROM postings d WHERE d.duplicate_of = p.id) AS dup_sources,
         an.state AS an_state, json_extract(an.content_json, '$.verdict') AS an_verdict
  FROM postings p
  LEFT JOIN posting_facts f ON f.posting_id = p.id
  LEFT JOIN matches m ON m.posting_id = p.id
  LEFT JOIN match_analyses an ON an.posting_id = p.id`;

function isStale(r: JoinedRow, versions: Versions | null): boolean {
  if (!versions || !r.m_state) return false;
  if (r.m_state === 'excluded') return r.rule_version !== versions.ruleVersion;
  if (r.m_state !== 'scored') return false;
  return r.rule_version !== versions.ruleVersion || r.judge_version !== versions.judgeVersion;
}

function toItem(r: JoinedRow, versions: Versions | null): PostingListItem {
  const facts = parseJson<PostingFacts | null>(r.facts_json, null);
  const others = (r.dup_sources ?? '').split(',').filter((s) => s && s !== r.source);
  return {
    id: r.id,
    title: r.title,
    company: r.company,
    location: r.location,
    source: r.source,
    sources: [r.source, ...others],
    url: r.url,
    postedAt: r.posted_at,
    firstSeenAt: r.first_seen_at,
    triageStatus: r.triage_status as TriageStatus,
    triageOrigin: (r.triage_origin as 'user' | 'auto' | null) ?? null,
    unread: r.read_at === null,
    linkStatus: r.link_status as LinkStatus,
    lacksDescription: r.lacks_description === 1,
    duplicateOf: r.duplicate_of,
    workArrangement: facts?.workArrangement ?? null,
    tags: facts?.requiredSkills.slice(0, 6) ?? [],
    match: r.m_state ? { state: r.m_state as MatchState, totalScore: r.total_score, stale: isStale(r, versions), excludedReason: r.excluded_reason } : null,
    analysis: r.an_state ? { state: r.an_state as 'pending' | 'ready' | 'failed', verdict: (r.an_verdict as AnalysisVerdict | null) ?? null } : null,
  };
}

function buildWhere(q: PostingQuery): { where: string; params: unknown[] } {
  const clauses: string[] = [];
  const params: unknown[] = [];
  const statuses = (q.status ?? 'new,saved')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (!statuses.includes('all')) {
    clauses.push(`p.triage_status IN (${statuses.map(() => '?').join(',')})`);
    params.push(...statuses);
  }
  if (!q.showDuplicates) clauses.push('p.duplicate_of IS NULL');
  if (!q.showExcluded) clauses.push(`(m.state IS NULL OR m.state != 'excluded')`);
  if (q.source) {
    clauses.push(`(p.source = ? OR EXISTS (SELECT 1 FROM postings d WHERE d.duplicate_of = p.id AND d.source = ?))`);
    params.push(q.source, q.source);
  }
  if (q.work) {
    clauses.push(`json_extract(f.facts_json, '$.workArrangement') = ?`);
    params.push(q.work);
  }
  if (q.minScore !== undefined && q.minScore > 0) {
    clauses.push('m.total_score >= ?');
    params.push(q.minScore);
  }
  if (q.tag) {
    clauses.push(`EXISTS (SELECT 1 FROM json_each(f.facts_json, '$.requiredSkills') t WHERE lower(t.value) = lower(?))`);
    params.push(q.tag);
  }
  if (q.maxAgeDays !== undefined && q.maxAgeDays > 0) {
    clauses.push('COALESCE(p.posted_at, p.first_seen_at) >= ?');
    params.push(isoAfter(-q.maxAgeDays * 86_400_000));
  }
  if (q.q?.trim()) {
    const like = `%${q.q.trim().replace(/[%_]/g, (c) => `\\${c}`)}%`;
    clauses.push(`(p.title LIKE ? ESCAPE '\\' OR p.company LIKE ? ESCAPE '\\' OR p.description LIKE ? ESCAPE '\\')`);
    params.push(like, like, like);
  }
  if (q.unread) clauses.push('p.read_at IS NULL');
  return { where: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '', params };
}

/**
 * Ranking order: scored postings first, by total score from high to low.
 * Equal scores rank by posted date, newest first. Excluded and unscored postings come after scored ones.
 */
const ORDER_BY_SCORE = `ORDER BY (m.total_score IS NULL) ASC, m.total_score DESC, COALESCE(p.posted_at, p.first_seen_at) DESC, p.id ASC`;
const ORDER_BY_NEWEST = `ORDER BY COALESCE(p.posted_at, p.first_seen_at) DESC, p.id ASC`;

export function listPostings(q: PostingQuery): PostingListResponse {
  const { where, params } = buildWhere(q);
  const limit = Math.min(200, Math.max(1, q.limit ?? 50));
  const offset = Math.max(0, q.offset ?? 0);
  const order = q.sort === 'newest' ? ORDER_BY_NEWEST : ORDER_BY_SCORE;
  const versions = currentVersions();
  const rows = sqlite.prepare(`${SELECT} ${where} ${order} LIMIT ? OFFSET ?`).all(...params, limit, offset) as JoinedRow[];
  const total = (
    sqlite
      .prepare(`SELECT COUNT(*) AS n FROM postings p LEFT JOIN posting_facts f ON f.posting_id = p.id LEFT JOIN matches m ON m.posting_id = p.id ${where}`)
      .get(...params) as { n: number }
  ).n;
  return {
    items: rows.map((r) => toItem(r, versions)),
    total,
    nextOffset: offset + rows.length < total ? offset + rows.length : null,
  };
}

export function getPostingDetail(id: string): PostingDetail | null {
  const r = sqlite.prepare(`${SELECT} WHERE p.id = ?`).get(id) as JoinedRow | undefined;
  if (!r) return null;
  const versions = currentVersions();
  const item = toItem(r, versions);
  const duplicates = sqlite.prepare('SELECT id, source, url FROM postings WHERE duplicate_of = ? ORDER BY first_seen_at').all(id) as Array<{
    id: string;
    source: string;
    url: string;
  }>;
  const match: MatchDetail | null = item.match
    ? {
        ...item.match,
        failReason: r.fail_reason,
        skillsScore: r.skills_score,
        experienceScore: r.experience_score,
        preferenceScore: r.preference_score,
        locationScore: r.location_score,
        matchedSkills: parseJson<string[]>(r.matched_skills, []),
        missingSkills: parseJson<string[]>(r.missing_skills, []),
        assessment: r.assessment,
        softViolations: parseJson<SoftViolationView[]>(r.soft_violations, []),
        provider: r.provider,
        model: r.model,
      }
    : null;
  return {
    ...item,
    description: r.description,
    facts: parseJson<PostingFacts | null>(r.facts_json, null),
    match,
    sourceLinks: [{ id: r.id, source: r.source, url: r.url, primary: true }, ...duplicates.map((d) => ({ ...d, primary: false }))],
    application: getApplication(id) as PostingDetail['application'],
    coverLetter: getCoverLetter(id),
    matchAnalysis: getMatchAnalysis(id),
  };
}

export function getCounts(): PostingCounts {
  const rows = sqlite
    .prepare(
      `SELECT p.triage_status AS s, COUNT(*) AS n FROM postings p LEFT JOIN matches m ON m.posting_id = p.id
       WHERE p.duplicate_of IS NULL AND (m.state IS NULL OR m.state != 'excluded') GROUP BY p.triage_status`,
    )
    .all() as Array<{ s: string; n: number }>;
  const counts: PostingCounts = { new: 0, saved: 0, applied: 0, dismissed: 0, unread: 0, excluded: 0, openApplications: 0 };
  for (const r of rows) if (r.s in counts) (counts as unknown as Record<string, number>)[r.s] = r.n;
  counts.unread = (
    sqlite
      .prepare(
        `SELECT COUNT(*) AS n FROM postings p LEFT JOIN matches m ON m.posting_id = p.id
         WHERE p.duplicate_of IS NULL AND p.read_at IS NULL AND p.triage_status IN ('new', 'saved') AND (m.state IS NULL OR m.state != 'excluded')`,
      )
      .get() as { n: number }
  ).n;
  counts.excluded = (
    sqlite
      .prepare(`SELECT COUNT(*) AS n FROM matches m JOIN postings p ON p.id = m.posting_id WHERE m.state = 'excluded' AND p.duplicate_of IS NULL`)
      .get() as { n: number }
  ).n;
  counts.openApplications = (
    sqlite.prepare(`SELECT COUNT(*) AS n FROM applications WHERE stage IN ('applied', 'interview', 'offer')`).get() as { n: number }
  ).n;
  return counts;
}

const STATUS_OF: Record<Exclude<TriageAction, 'apply'>, TriageStatus> = { save: 'saved', dismiss: 'dismissed', restore: 'new' };

/** Applies one triage action to several postings. Returns the earlier statuses, so the client can undo the action. */
export function applyTriage(ids: string[], action: TriageAction): TriageResult {
  const previous: TriageResult['previous'] = [];
  const read = sqlite.prepare('SELECT triage_status FROM postings WHERE id = ?');
  for (const id of ids) {
    const row = read.get(id) as { triage_status: string } | undefined;
    if (!row) continue;
    // An applied posting has an application with notes and history. Only the removal of the application changes its status.
    if (row.triage_status === 'applied') continue;
    previous.push({ id, triageStatus: row.triage_status as TriageStatus });
    setTriage(id, action === 'apply' ? 'applied' : STATUS_OF[action]);
  }
  return { previous };
}

/** Sets one status. "applied" creates the application. Leaving "applied" removes it. */
export function setTriage(id: string, status: TriageStatus): boolean {
  const row = sqlite.prepare('SELECT triage_status FROM postings WHERE id = ?').get(id) as { triage_status: string } | undefined;
  if (!row) return false;
  if (status === 'applied') {
    createApplication(id);
  } else {
    if (row.triage_status === 'applied') removeApplication(id);
    sqlite.prepare(`UPDATE postings SET triage_status = ?, triage_origin = 'user' WHERE id = ?`).run(status, id);
  }
  publish({ type: 'posting.updated', postingId: id });
  return true;
}

export function markRead(ids: string[], read: boolean): void {
  const stmt = sqlite.prepare('UPDATE postings SET read_at = ? WHERE id = ?');
  const now = read ? nowIso() : null;
  sqlite.transaction(() => {
    for (const id of ids) stmt.run(now, id);
  })();
}

export function listSourcesUsed(): string[] {
  return (sqlite.prepare('SELECT DISTINCT source FROM postings ORDER BY source').all() as Array<{ source: string }>).map((r) => r.source);
}
