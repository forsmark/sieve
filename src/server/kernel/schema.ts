import { sql } from 'drizzle-orm';
import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

export const postings = sqliteTable(
  'postings',
  {
    id: text('id').primaryKey(),
    source: text('source').notNull(),
    externalId: text('external_id').notNull(),
    title: text('title').notNull(),
    company: text('company').notNull(),
    location: text('location'),
    url: text('url').notNull(),
    description: text('description'),
    /** 1 when enrichment failed and the system scores from title, company, and location only. */
    lacksDescription: integer('lacks_description').notNull().default(0),
    /** When the enrich task last tried to fetch the full description. Null when it never ran. */
    enrichedAt: text('enriched_at'),
    postedAt: text('posted_at'),
    firstSeenAt: text('first_seen_at').notNull(),
    companyKey: text('company_key').notNull(),
    fingerprint: text('fingerprint').notNull(),
    duplicateOf: text('duplicate_of'),
    /** 1 when the user separated this posting from a primary record. Detection then skips it. */
    duplicateLocked: integer('duplicate_locked').notNull().default(0),
    linkStatus: text('link_status').notNull().default('unchecked'),
    linkCheckedAt: text('link_checked_at'),
    triageStatus: text('triage_status').notNull().default('new'),
    /** 'user' or 'auto'. Auto means automatic dismissal of a low score. */
    triageOrigin: text('triage_origin'),
    readAt: text('read_at'),
  },
  (t) => [
    uniqueIndex('postings_source_external').on(t.source, t.externalId),
    index('postings_fingerprint').on(t.fingerprint),
    index('postings_company_key').on(t.companyKey),
    index('postings_triage').on(t.triageStatus),
  ],
);

export const postingFacts = sqliteTable('posting_facts', {
  postingId: text('posting_id').primaryKey(),
  factsJson: text('facts_json').notNull(),
  descriptionHash: text('description_hash').notNull(),
  provider: text('provider').notNull(),
  model: text('model').notNull(),
  createdAt: text('created_at').notNull(),
});

export const matches = sqliteTable(
  'matches',
  {
    postingId: text('posting_id').primaryKey(),
    /** waiting | in_progress | scored | excluded | failed */
    state: text('state').notNull().default('waiting'),
    failReason: text('fail_reason'),
    judgeVersion: text('judge_version'),
    ruleVersion: text('rule_version'),
    excludedReason: text('excluded_reason'),
    softViolations: text('soft_violations').notNull().default('[]'),
    skillsScore: integer('skills_score'),
    experienceScore: integer('experience_score'),
    preferenceScore: integer('preference_score'),
    locationScore: integer('location_score'),
    totalScore: integer('total_score'),
    matchedSkills: text('matched_skills').notNull().default('[]'),
    missingSkills: text('missing_skills').notNull().default('[]'),
    assessment: text('assessment'),
    provider: text('provider'),
    model: text('model'),
    firstScoredAt: text('first_scored_at'),
    updatedAt: text('updated_at'),
    notifyQueuedAt: text('notify_queued_at'),
    notifiedAt: text('notified_at'),
  },
  (t) => [index('matches_total').on(t.totalScore)],
);

export const profile = sqliteTable('profile', {
  id: integer('id').primaryKey(),
  cvText: text('cv_text').notNull(),
  derivedJson: text('derived_json'),
  editsJson: text('edits_json').notNull().default('{}'),
  deriveState: text('derive_state').notNull().default('idle'),
  deriveError: text('derive_error'),
  updatedAt: text('updated_at').notNull(),
});

export const preferences = sqliteTable('preferences', {
  id: integer('id').primaryKey(),
  prefsJson: text('prefs_json').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const applications = sqliteTable('applications', {
  postingId: text('posting_id').primaryKey(),
  stage: text('stage').notNull().default('applied'),
  notes: text('notes'),
  interviewAt: text('interview_at'),
  appliedAt: text('applied_at').notNull(),
  updatedAt: text('updated_at').notNull(),
  snapshotJson: text('snapshot_json').notNull(),
});

export const applicationEvents = sqliteTable(
  'application_events',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    postingId: text('posting_id').notNull(),
    fromStage: text('from_stage'),
    toStage: text('to_stage').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (t) => [index('application_events_posting').on(t.postingId)],
);

export const fetchRuns = sqliteTable('fetch_runs', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  trigger: text('trigger').notNull(),
  /** running | completed | interrupted */
  state: text('state').notNull(),
  startedAt: text('started_at').notNull(),
  endedAt: text('ended_at'),
});

export const fetchRunSources = sqliteTable(
  'fetch_run_sources',
  {
    runId: integer('run_id').notNull(),
    source: text('source').notNull(),
    /** running | completed | failed | skipped */
    state: text('state').notNull(),
    found: integer('found').notNull().default(0),
    added: integer('added').notNull().default(0),
    invalid: integer('invalid').notNull().default(0),
    error: text('error'),
  },
  (t) => [primaryKey({ columns: [t.runId, t.source] })],
);

export const tasks = sqliteTable(
  'tasks',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    kind: text('kind').notNull(),
    subjectId: text('subject_id').notNull(),
    payload: text('payload').notNull().default('{}'),
    /** pending | running | done | failed */
    state: text('state').notNull().default('pending'),
    attempts: integer('attempts').notNull().default(0),
    priority: integer('priority').notNull().default(0),
    runAfter: text('run_after').notNull(),
    lockedAt: text('locked_at'),
    lastError: text('last_error'),
    createdAt: text('created_at').notNull(),
    finishedAt: text('finished_at'),
  },
  (t) => [
    uniqueIndex('tasks_open_unique')
      .on(t.kind, t.subjectId)
      .where(sql`state IN ('pending', 'running')`),
    index('tasks_claim').on(t.state, t.runAfter),
  ],
);

export const schedule = sqliteTable('schedule', {
  id: integer('id').primaryKey(),
  intervalHours: integer('interval_hours').notNull().default(4),
  paused: integer('paused').notNull().default(0),
  nextRunAt: text('next_run_at'),
});

export const sessions = sqliteTable('sessions', {
  tokenHash: text('token_hash').primaryKey(),
  expiresAt: text('expires_at').notNull(),
});

export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const logs = sqliteTable('logs', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  level: text('level').notNull(),
  message: text('message').notNull(),
  createdAt: text('created_at').notNull(),
});

export const notifications = sqliteTable('notifications', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  postingIds: text('posting_ids').notNull(),
  /** sent | failed */
  state: text('state').notNull(),
  attempts: integer('attempts').notNull().default(0),
  error: text('error'),
  createdAt: text('created_at').notNull(),
  sentAt: text('sent_at'),
});

/** One expanded match analysis for each posting. A new generation replaces the content only when it succeeds. */
export const matchAnalyses = sqliteTable('match_analyses', {
  postingId: text('posting_id').primaryKey(),
  state: text('state').notNull().default('pending'),
  contentJson: text('content_json'),
  error: text('error'),
  model: text('model'),
  generatedAt: text('generated_at'),
  updatedAt: text('updated_at').notNull(),
});

/** One cover letter for each posting. A new generation replaces the text only when it succeeds. */
export const coverLetters = sqliteTable('cover_letters', {
  postingId: text('posting_id').primaryKey(),
  state: text('state').notNull().default('pending'),
  text: text('text'),
  language: text('language'),
  instruction: text('instruction'),
  error: text('error'),
  model: text('model'),
  edited: integer('edited').notNull().default(0),
  generatedAt: text('generated_at'),
  updatedAt: text('updated_at').notNull(),
});
