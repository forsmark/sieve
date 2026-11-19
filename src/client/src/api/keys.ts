import type { PostingQuery } from '../../../shared/api';

/** Every TanStack Query key in one place, so the SSE handler and the mutations agree on them. */
export const qk = {
  auth: ['auth'] as const,
  status: ['status'] as const,
  postingsAll: ['postings'] as const,
  postings: (query: PostingQuery) => ['postings', query] as const,
  posting: (id: string) => ['posting', id] as const,
  postingAll: ['posting'] as const,
  applications: ['applications'] as const,
  applicationEvents: (id: string) => ['application-events', id] as const,
  applicationEventsAll: ['application-events'] as const,
  profile: ['profile'] as const,
  preferences: ['preferences'] as const,
  sources: ['sources'] as const,
  search: ['search'] as const,
  schedule: ['schedule'] as const,
  runs: ['runs'] as const,
  llm: ['llm'] as const,
  notifications: ['notifications'] as const,
  activity: ['activity'] as const,
  logsAll: ['logs'] as const,
  logs: (level: string) => ['logs', level] as const,
  backups: ['backups'] as const,
};
