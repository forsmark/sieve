import type { ApplicationStage, LinkStatus, MatchState, PostingFacts, Preferences, StructuredProfile, TriageStatus } from './schemas';

/** Types of the JSON that the server sends. Server and client both import this file. */

export interface MatchSummary {
  state: MatchState;
  totalScore: number | null;
  /** True when the score comes from an older profile version. */
  stale: boolean;
  excludedReason: string | null;
}

export interface PostingListItem {
  id: string;
  title: string;
  company: string;
  location: string | null;
  /** The source of the primary record. */
  source: string;
  /** Every source that carries this job, the primary one first. */
  sources: string[];
  url: string;
  postedAt: string | null;
  firstSeenAt: string;
  triageStatus: TriageStatus;
  triageOrigin: 'user' | 'auto' | null;
  unread: boolean;
  linkStatus: LinkStatus;
  lacksDescription: boolean;
  duplicateOf: string | null;
  workArrangement: 'remote' | 'hybrid' | 'onsite' | null;
  tags: string[];
  match: MatchSummary | null;
  /** Absent or null when no expanded analysis was requested. */
  analysis?: MatchAnalysisSummary | null;
}

export interface SoftViolationView {
  kind: 'language' | 'work_arrangement';
  detail: string;
}

export interface MatchDetail extends MatchSummary {
  failReason: string | null;
  skillsScore: number | null;
  experienceScore: number | null;
  preferenceScore: number | null;
  locationScore: number | null;
  matchedSkills: string[];
  missingSkills: string[];
  assessment: string | null;
  softViolations: SoftViolationView[];
  provider: string | null;
  model: string | null;
}

export interface ApplicationDto {
  postingId: string;
  stage: ApplicationStage;
  notes: string | null;
  interviewAt: string | null;
  appliedAt: string;
  updatedAt: string;
  snapshot: { title: string; company: string; location: string | null; url: string; description: string | null; facts: PostingFacts | null };
  linkStatus: string | null;
  totalScore: number | null;
}

export interface ApplicationEventDto {
  id: number;
  fromStage: string | null;
  toStage: string;
  createdAt: string;
}

export interface PostingDetail extends Omit<PostingListItem, 'match'> {
  description: string | null;
  facts: PostingFacts | null;
  match: MatchDetail | null;
  sourceLinks: Array<{ id: string; source: string; url: string; primary: boolean }>;
  application: ApplicationDto | null;
  coverLetter: CoverLetterDto | null;
  matchAnalysis: MatchAnalysisDto | null;
}

export type AnalysisVerdict = 'apply' | 'consider' | 'skip';

/** What the writing model returns for an expanded match analysis. */
export interface MatchAnalysisContent {
  verdict: AnalysisVerdict;
  summary: string;
  strengths: Array<{ point: string; evidence: string }>;
  gaps: Array<{ point: string; severity: 'blocking' | 'significant' | 'minor'; mitigation: string }>;
  /** Questions to ask the employer. */
  unknowns: string[];
  /** What to emphasize in an application. */
  positioning: string[];
  /** Revised part scores from 0 to 100. Absent in analyses written before the analysis gave scores. */
  scores?: { skills: number; experience: number; preferences: number };
}

export interface MatchAnalysisDto {
  postingId: string;
  /** "pending" while the model works. "failed" when no content exists and the last attempt failed. */
  state: 'pending' | 'ready' | 'failed';
  content: MatchAnalysisContent | null;
  /** The cause of the last failed attempt. An earlier analysis can still exist. */
  error: string | null;
  model: string | null;
  generatedAt: string | null;
  updatedAt: string;
  /** The total that the revised part scores give under the current rules. Null when the analysis has no scores or no total can be computed. */
  proposedTotal: number | null;
  /** True when the stored part scores of the posting are the revised part scores of this analysis. */
  scoreApplied: boolean;
}

/** The part of an expanded match analysis that a card shows. */
export interface MatchAnalysisSummary {
  state: 'pending' | 'ready' | 'failed';
  verdict: AnalysisVerdict | null;
}

export interface CoverLetterDto {
  postingId: string;
  /** "pending" while the model writes. "failed" when no text exists and the last attempt failed. */
  state: 'pending' | 'ready' | 'failed';
  text: string | null;
  /** English name of the language of the letter. */
  language: string | null;
  instruction: string | null;
  /** The cause of the last failed attempt. An earlier text can still exist. */
  error: string | null;
  model: string | null;
  /** True when the user changed the text after the generation. */
  edited: boolean;
  generatedAt: string | null;
  updatedAt: string;
}

export interface PostingListResponse {
  items: PostingListItem[];
  total: number;
  nextOffset: number | null;
}

export interface PostingCounts {
  new: number;
  saved: number;
  applied: number;
  dismissed: number;
  unread: number;
  excluded: number;
}

export interface PostingQuery {
  /** Comma-separated triage statuses. Default "new,saved". "all" gives every status. */
  status?: string;
  source?: string;
  work?: string;
  minScore?: number;
  tag?: string;
  maxAgeDays?: number;
  q?: string;
  unread?: boolean;
  showExcluded?: boolean;
  showDuplicates?: boolean;
  sort?: 'score' | 'newest';
  offset?: number;
  limit?: number;
}

export type TriageAction = 'save' | 'dismiss' | 'restore' | 'apply';
export type BulkAction = TriageAction | 'rescore' | 'read' | 'unread' | 'analyze';

export interface TriageResult {
  /** The status of each posting before the action. The client sends these back to undo the action. */
  previous: Array<{ id: string; triageStatus: TriageStatus }>;
}

export interface RunSourceDto {
  source: string;
  state: 'running' | 'completed' | 'failed' | 'skipped';
  found: number;
  added: number;
  invalid: number;
  error: string | null;
}

export interface RunDto {
  id: number;
  trigger: string;
  state: 'running' | 'completed' | 'interrupted';
  startedAt: string;
  endedAt: string | null;
  sources: RunSourceDto[];
}

export interface SourceDto {
  id: string;
  name: string;
  enabled: boolean;
  supports: { keywords: boolean; region: boolean };
  lastResult: RunSourceDto | null;
  lastRunAt: string | null;
}

export interface ScheduleDto {
  intervalHours: number;
  paused: boolean;
  nextRunAt: string | null;
}

export interface StatusDto {
  authRequired: boolean;
  profileReady: boolean;
  hasCv: boolean;
  activeRunId: number | null;
  lastRunAt: string | null;
  schedule: ScheduleDto;
  queue: Record<string, number>;
  queueTotal: number;
  matchingPaused: boolean;
  /** Null until the first health probe finished. */
  llmAvailable: boolean | null;
  llmProvider: 'local' | 'claude-code';
  searchTermCount: number;
  counts: PostingCounts;
}

export interface ProfileDto {
  hasCv: boolean;
  cvText: string;
  derived: StructuredProfile | null;
  effective: StructuredProfile | null;
  hasEdits: boolean;
  deriveState: 'idle' | 'pending' | 'failed';
  deriveError: string | null;
  updatedAt: string | null;
}

export interface RescorePlanDto {
  rulesOnly: number;
  judge: number;
  extract: number;
}

export interface PreferencesSaveResult {
  preferences: Preferences;
  /** The work that the change caused. `judge` and `extract` cost model calls. */
  plan: RescorePlanDto;
}

export interface LlmSettingsDto {
  provider: 'local' | 'claude-code';
  baseUrl: string;
  model: string;
  apiKey: string;
  claudeEffort: 'low' | 'medium';
  claudeModel: string;
  /** The model for the CV digest and cover letters. It always runs through the claude command. */
  writingModel: string;
  writingEffort: string;
}

export interface HealthDto {
  reachable: boolean;
  modelAvailable: boolean;
  detail?: string;
}

export interface NotificationSettingsDto {
  enabled: boolean;
  server: string;
  topic: string | null;
  subscribeUrl: string | null;
  threshold: number;
  windowSeconds: number;
  appBaseUrl: string;
}

export interface FailedTaskDto {
  id: number;
  kind: string;
  subjectId: string;
  subjectTitle: string | null;
  attempts: number;
  lastError: string | null;
  finishedAt: string | null;
}

export interface LogDto {
  id: number;
  level: 'info' | 'warn' | 'error';
  message: string;
  createdAt: string;
}

export interface BackupDto {
  name: string;
  size: number;
  createdAt: string;
}

export interface NotificationLogDto {
  id: number;
  count: number;
  state: 'sent' | 'failed';
  error: string | null;
  createdAt: string;
}

export interface ActivityDto {
  runs: RunDto[];
  failedTasks: FailedTaskDto[];
  notifications: NotificationLogDto[];
}

export type ServerEvent =
  | { type: 'run.progress'; runId: number }
  | { type: 'posting.added'; postingId: string }
  | { type: 'posting.updated'; postingId: string }
  | { type: 'match.updated'; postingId: string }
  | { type: 'queue.changed' }
  | { type: 'llm.status'; available: boolean }
  | { type: 'profile.updated' }
  | { type: 'application.updated'; postingId: string };

export interface ApiError {
  error: string;
}
