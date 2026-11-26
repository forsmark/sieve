import { sqlite, parseJson } from '../kernel/db';
import { nowIso } from '../kernel/clock';
import { publish } from '../kernel/events';
import { ApplicationStage } from '../../shared/schemas';

interface ApplicationRow {
  posting_id: string;
  stage: string;
  notes: string | null;
  interview_at: string | null;
  applied_at: string;
  updated_at: string;
  snapshot_json: string;
}

export interface ApplicationSnapshot {
  title: string;
  company: string;
  location: string | null;
  url: string;
  description: string | null;
  facts: unknown;
}

export interface ApplicationView {
  postingId: string;
  stage: ApplicationStage;
  notes: string | null;
  interviewAt: string | null;
  appliedAt: string;
  updatedAt: string;
  snapshot: ApplicationSnapshot;
  linkStatus: string | null;
  totalScore: number | null;
}

export interface ApplicationEventView {
  id: number;
  fromStage: string | null;
  toStage: string;
  createdAt: string;
}

function toView(r: ApplicationRow & { link_status?: string | null; total_score?: number | null }): ApplicationView {
  return {
    postingId: r.posting_id,
    stage: r.stage as ApplicationStage,
    notes: r.notes,
    interviewAt: r.interview_at,
    appliedAt: r.applied_at,
    updatedAt: r.updated_at,
    snapshot: parseJson<ApplicationSnapshot>(r.snapshot_json, { title: '', company: '', location: null, url: '', description: null, facts: null }),
    linkStatus: r.link_status ?? null,
    totalScore: r.total_score ?? null,
  };
}

/**
 * Creates the application for a posting, with a copy of the posting.
 * A posting has at most one application. A second call keeps the existing one.
 */
export function createApplication(postingId: string): ApplicationView | null {
  const posting = sqlite.prepare('SELECT id, title, company, location, url, description FROM postings WHERE id = ?').get(postingId) as
    { id: string; title: string; company: string; location: string | null; url: string; description: string | null } | undefined;
  if (!posting) return null;
  const facts = sqlite.prepare('SELECT facts_json FROM posting_facts WHERE posting_id = ?').get(postingId) as { facts_json: string } | undefined;
  const snapshot: ApplicationSnapshot = {
    title: posting.title,
    company: posting.company,
    location: posting.location,
    url: posting.url,
    description: posting.description,
    facts: parseJson(facts?.facts_json, null),
  };
  const now = nowIso();
  sqlite.transaction(() => {
    const r = sqlite
      .prepare(`INSERT OR IGNORE INTO applications (posting_id, stage, applied_at, updated_at, snapshot_json) VALUES (?, 'applied', ?, ?, ?)`)
      .run(postingId, now, now, JSON.stringify(snapshot));
    if (r.changes > 0) {
      sqlite.prepare(`INSERT INTO application_events (posting_id, from_stage, to_stage, created_at) VALUES (?, NULL, 'applied', ?)`).run(postingId, now);
    }
    sqlite.prepare(`UPDATE postings SET triage_status = 'applied', triage_origin = 'user' WHERE id = ?`).run(postingId);
  })();
  publish({ type: 'application.updated', postingId });
  return getApplication(postingId);
}

export function getApplication(postingId: string): ApplicationView | null {
  const r = sqlite
    .prepare(
      `SELECT a.*, p.link_status, m.total_score FROM applications a
       LEFT JOIN postings p ON p.id = a.posting_id LEFT JOIN matches m ON m.posting_id = a.posting_id WHERE a.posting_id = ?`,
    )
    .get(postingId) as ApplicationRow | undefined;
  return r ? toView(r) : null;
}

export function listApplications(): ApplicationView[] {
  const rows = sqlite
    .prepare(
      `SELECT a.*, p.link_status, m.total_score FROM applications a
       LEFT JOIN postings p ON p.id = a.posting_id LEFT JOIN matches m ON m.posting_id = a.posting_id
       ORDER BY a.updated_at DESC`,
    )
    .all() as ApplicationRow[];
  return rows.map(toView);
}

export interface ApplicationPatch {
  stage?: ApplicationStage;
  notes?: string | null;
  interviewAt?: string | null;
}

/** Updates stage, notes, or interview date. Every stage change is recorded in the history. */
export function updateApplication(postingId: string, patch: ApplicationPatch): ApplicationView | null {
  const current = sqlite.prepare('SELECT * FROM applications WHERE posting_id = ?').get(postingId) as ApplicationRow | undefined;
  if (!current) return null;
  const now = nowIso();
  const stage = patch.stage !== undefined ? ApplicationStage.parse(patch.stage) : (current.stage as ApplicationStage);
  let interviewAt = current.interview_at;
  if (patch.interviewAt !== undefined) {
    if (patch.interviewAt === null || patch.interviewAt === '') interviewAt = null;
    else {
      const d = new Date(patch.interviewAt);
      if (Number.isNaN(d.getTime())) throw new Error('The interview date is not a valid date.');
      interviewAt = d.toISOString();
    }
  }
  const notes = patch.notes !== undefined ? patch.notes : current.notes;
  sqlite.transaction(() => {
    sqlite
      .prepare('UPDATE applications SET stage = ?, notes = ?, interview_at = ?, updated_at = ? WHERE posting_id = ?')
      .run(stage, notes, interviewAt, now, postingId);
    if (stage !== current.stage) {
      sqlite
        .prepare('INSERT INTO application_events (posting_id, from_stage, to_stage, created_at) VALUES (?, ?, ?, ?)')
        .run(postingId, current.stage, stage, now);
    }
  })();
  publish({ type: 'application.updated', postingId });
  return getApplication(postingId);
}

export function listApplicationEvents(postingId: string): ApplicationEventView[] {
  const rows = sqlite
    .prepare('SELECT id, from_stage, to_stage, created_at FROM application_events WHERE posting_id = ? ORDER BY id ASC')
    .all(postingId) as Array<{ id: number; from_stage: string | null; to_stage: string; created_at: string }>;
  return rows.map((r) => ({ id: r.id, fromStage: r.from_stage, toStage: r.to_stage, createdAt: r.created_at }));
}

/** Deletes the application and its history. The posting returns to the triage status "saved". */
export function removeApplication(postingId: string): boolean {
  const done = sqlite.transaction(() => {
    const r = sqlite.prepare('DELETE FROM applications WHERE posting_id = ?').run(postingId);
    if (r.changes === 0) return false;
    sqlite.prepare('DELETE FROM application_events WHERE posting_id = ?').run(postingId);
    sqlite.prepare(`UPDATE postings SET triage_status = 'saved', triage_origin = 'user' WHERE id = ?`).run(postingId);
    return true;
  })();
  if (done) {
    publish({ type: 'application.updated', postingId });
    publish({ type: 'posting.updated', postingId });
  }
  return done;
}
