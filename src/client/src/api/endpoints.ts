import type {
  ActivityDto,
  ApplicationDto,
  ApplicationEventDto,
  BackupDto,
  BulkAction,
  ClearPreviewDto,
  ClearResultDto,
  CoverLetterDto,
  HealthDto,
  LlmSettingsDto,
  LogDto,
  MatchAnalysisDto,
  NotificationSettingsDto,
  PostingDetail,
  PostingListResponse,
  PostingQuery,
  PreferencesSaveResult,
  ProfileDto,
  RescorePlanDto,
  RunDto,
  ScheduleDto,
  SourceDto,
  StatusDto,
  TriageAction,
  TriageResult,
} from '../../../shared/api';
import type { ApplicationStage, Preferences, StructuredProfile, TriageStatus } from '../../../shared/schemas';
import { apiPath, request, toQueryString } from './client';

/** Typed helpers for every route in `src/server/http/app.ts`. */

export interface AuthState {
  authRequired: boolean;
  authenticated: boolean;
}

export interface SearchSettings {
  terms: string[];
  region: string;
}

export interface BackupList {
  backups: BackupDto[];
  settings: { intervalHours: number; keep: number; lastAt: string | null };
}

export interface LlmState {
  settings: LlmSettingsDto;
  available: boolean | null;
}

export type LlmSaveInput = Omit<LlmSettingsDto, 'claudeModel' | 'writingModel' | 'writingEffort'>;

export interface LlmSaveResult {
  saved: boolean;
  health: HealthDto;
  settings: LlmSettingsDto;
}

export interface NotificationPatch {
  enabled?: boolean;
  server?: string;
  threshold?: number;
  windowSeconds?: number;
  appBaseUrl?: string;
}

export const api = {
  // Auth
  me: () => request<AuthState>('/api/auth/me'),
  login: (password: string) => request<{ ok: true }>('/api/auth/login', { method: 'POST', body: { password } }),
  logout: () => request<{ ok: true }>('/api/auth/logout', { method: 'POST' }),

  // Status
  status: () => request<StatusDto>('/api/status'),

  // Postings
  listPostings: (q: PostingQuery, signal?: AbortSignal) => request<PostingListResponse>(`/api/postings${toQueryString({ ...q })}`, { signal }),
  posting: (id: string) => request<PostingDetail>(`/api/postings/${encodeURIComponent(id)}`),
  bulk: (ids: string[], action: BulkAction) => request<TriageResult & { queued?: number }>('/api/postings/bulk', { method: 'POST', body: { ids, action } }),
  triage: (ids: string[], action: TriageAction) => request<TriageResult>('/api/postings/bulk', { method: 'POST', body: { ids, action } }),
  restore: (previous: Array<{ id: string; triageStatus: TriageStatus }>) =>
    request<{ ok: true }>('/api/postings/restore', { method: 'POST', body: { previous } }),
  markRead: (id: string, read: boolean) =>
    request<TriageResult & { posting: PostingDetail }>(`/api/postings/${encodeURIComponent(id)}`, { method: 'PATCH', body: { read } }),
  separate: (id: string) => request<PostingDetail>(`/api/postings/${encodeURIComponent(id)}/separate`, { method: 'POST' }),
  requestAnalysis: (id: string) => request<MatchAnalysisDto>(`/api/postings/${encodeURIComponent(id)}/analysis`, { method: 'POST' }),
  applyAnalysisScore: (id: string) => request<MatchAnalysisDto>(`/api/postings/${encodeURIComponent(id)}/analysis/apply-score`, { method: 'POST' }),
  deleteAnalysis: (id: string) => request<{ ok: true }>(`/api/postings/${encodeURIComponent(id)}/analysis`, { method: 'DELETE' }),
  generateCoverLetter: (id: string, instruction: string | null) =>
    request<CoverLetterDto>(`/api/postings/${encodeURIComponent(id)}/cover-letter`, { method: 'POST', body: { instruction } }),
  saveCoverLetter: (id: string, text: string) =>
    request<CoverLetterDto>(`/api/postings/${encodeURIComponent(id)}/cover-letter`, { method: 'PUT', body: { text } }),
  coverLetterPdfUrl: (id: string) => apiPath(`/api/postings/${encodeURIComponent(id)}/cover-letter.pdf`),
  rescore: (id: string) => request<{ queued: number }>(`/api/postings/${encodeURIComponent(id)}/rescore`, { method: 'POST' }),

  // Profile and preferences
  profile: () => request<ProfileDto>('/api/profile'),
  uploadCv: (file: File, edits: 'keep' | 'discard') => {
    const form = new FormData();
    form.set('file', file);
    form.set('edits', edits);
    return request<ProfileDto>('/api/profile/cv', { method: 'POST', body: form });
  },
  pasteCv: (text: string, edits: 'keep' | 'discard') => request<ProfileDto>('/api/profile/cv', { method: 'POST', body: { text, edits } }),
  saveProfile: (profile: StructuredProfile) => request<{ profile: ProfileDto; plan: RescorePlanDto }>('/api/profile', { method: 'PUT', body: profile }),
  derive: () => request<ProfileDto>('/api/profile/derive', { method: 'POST' }),
  discardEdits: () => request<{ profile: ProfileDto; plan: RescorePlanDto }>('/api/profile/edits', { method: 'DELETE' }),
  preferences: () => request<Preferences>('/api/preferences'),
  previewPreferences: (p: Preferences) => request<PreferencesSaveResult>('/api/preferences?dryRun=1', { method: 'PUT', body: p }),
  savePreferences: (p: Preferences) => request<PreferencesSaveResult>('/api/preferences', { method: 'PUT', body: p }),

  // Sources, search, schedule, runs
  sources: () => request<SourceDto[]>('/api/sources'),
  setSourceEnabled: (id: string, enabled: boolean) => request<SourceDto[]>(`/api/sources/${encodeURIComponent(id)}`, { method: 'PATCH', body: { enabled } }),
  search: () => request<SearchSettings>('/api/search'),
  saveSearch: (s: SearchSettings) => request<SearchSettings>('/api/search', { method: 'PUT', body: s }),
  schedule: () => request<ScheduleDto>('/api/schedule'),
  saveSchedule: (s: { intervalHours?: number; paused?: boolean }) => request<ScheduleDto>('/api/schedule', { method: 'PUT', body: s }),
  fetchNow: () => request<{ started: boolean; runId: number | null }>('/api/fetch', { method: 'POST' }),
  runs: () => request<RunDto[]>('/api/runs'),

  // Language model
  llm: () => request<LlmState>('/api/llm'),
  /** The server answers 400 with `saved: false` when a new provider does not respond. */
  saveLlm: (s: LlmSaveInput) => request<LlmSaveResult>('/api/llm', { method: 'PUT', body: s, acceptStatus: [400] }),
  testLlm: () => request<HealthDto>('/api/llm/test', { method: 'POST' }),

  // Matching control
  pauseMatching: () => request<{ paused: boolean }>('/api/matching/pause', { method: 'POST' }),
  resumeMatching: () => request<{ paused: boolean }>('/api/matching/resume', { method: 'POST' }),
  stalePlan: () => request<RescorePlanDto>('/api/matching/stale'),
  rescoreStale: () => request<RescorePlanDto>('/api/matching/rescore-stale', { method: 'POST' }),

  // Notifications
  notifications: () => request<NotificationSettingsDto>('/api/notifications'),
  saveNotifications: (patch: NotificationPatch) => request<NotificationSettingsDto>('/api/notifications', { method: 'PUT', body: patch }),
  regenerateTopic: () => request<NotificationSettingsDto>('/api/notifications/regenerate', { method: 'POST' }),
  /** The server answers 502 with `ok: false` when ntfy fails. */
  testNotification: () => request<{ ok: boolean; error?: string }>('/api/notifications/test', { method: 'POST', acceptStatus: [502] }),

  // Applications
  applications: () => request<ApplicationDto[]>('/api/applications'),
  createApplication: (postingId: string) => request<ApplicationDto>('/api/applications', { method: 'POST', body: { postingId } }),
  applicationEvents: (id: string) => request<ApplicationEventDto[]>(`/api/applications/${encodeURIComponent(id)}/events`),
  updateApplication: (id: string, patch: { stage?: ApplicationStage; notes?: string | null; interviewAt?: string | null }) =>
    request<ApplicationDto>(`/api/applications/${encodeURIComponent(id)}`, { method: 'PATCH', body: patch, keepalive: true }),
  removeApplication: (id: string) => request<{ ok: true }>(`/api/applications/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  // Activity, logs, backups
  activity: () => request<ActivityDto>('/api/activity'),
  retryTask: (id: number) => request<{ ok: true }>(`/api/activity/tasks/${id}/retry`, { method: 'POST' }),
  logs: (level: string) => request<LogDto[]>(`/api/logs${toQueryString({ level: level === 'all' ? undefined : level })}`),
  backups: () => request<BackupList>('/api/backups'),
  createBackup: () => request<BackupDto>('/api/backups', { method: 'POST' }),
  backupUrl: (name: string) => apiPath(`/api/backups/${encodeURIComponent(name)}`),

  // Clear the postings
  clearPreview: () => request<ClearPreviewDto>('/api/postings/clear'),
  /** Sends the counts the user confirmed. The server refuses when they no longer hold. */
  clearPostings: (confirmed: { delete: number; saved: number }) => request<ClearResultDto>('/api/postings/clear', { method: 'POST', body: confirmed }),
};
