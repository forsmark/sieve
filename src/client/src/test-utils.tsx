import { vi } from 'vitest';
import { render } from '@testing-library/react';
import { createMemoryHistory } from '@tanstack/react-router';
import { QueryClient } from '@tanstack/react-query';
import type { PostingListItem, StatusDto } from '../../shared/api';
import { App } from './app/App';

export interface MockCall {
  method: string;
  path: string;
  body: unknown;
}

type Handler = (call: MockCall, url: URL) => unknown | Response;

/** A fetch mock that routes by "METHOD /path". Unknown routes answer 404. */
export function mockApi(routes: Record<string, Handler>) {
  const calls: MockCall[] = [];
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), 'http://localhost');
    const method = (init?.method ?? 'GET').toUpperCase();
    let body: unknown = undefined;
    if (typeof init?.body === 'string') body = JSON.parse(init.body);
    const call = { method, path: url.pathname, body };
    calls.push(call);
    const handler = routes[`${method} ${url.pathname}`];
    if (!handler) return new Response(JSON.stringify({ error: 'Not found.' }), { status: 404 });
    const result = await handler(call, url);
    if (result instanceof Response) return result;
    return new Response(JSON.stringify(result), { status: 200, headers: { 'Content-Type': 'application/json' } });
  });
  vi.stubGlobal('fetch', fn);
  return { fn, calls };
}

export function makeItem(id: string, score: number | null, extra: Partial<PostingListItem> = {}): PostingListItem {
  return {
    id,
    title: `Job ${id}`,
    company: `Company ${id}`,
    location: 'Copenhagen',
    source: 'jobindex',
    sources: ['jobindex'],
    url: `https://example.com/${id}`,
    postedAt: '2026-11-10T08:00:00Z',
    firstSeenAt: '2026-11-10T08:00:00Z',
    triageStatus: 'new',
    triageOrigin: null,
    unread: true,
    linkStatus: 'active',
    lacksDescription: false,
    duplicateOf: null,
    workArrangement: 'remote',
    tags: [],
    match: score === null ? null : { state: 'scored', totalScore: score, stale: false, excludedReason: null },
    ...extra,
  };
}

export const STATUS: StatusDto = {
  authRequired: false,
  profileReady: true,
  hasCv: true,
  activeRunId: null,
  lastRunAt: null,
  schedule: { intervalHours: 6, paused: false, nextRunAt: null },
  queue: {},
  queueTotal: 0,
  matchingPaused: false,
  llmAvailable: true,
  llmProvider: 'local',
  searchTermCount: 1,
  counts: { new: 3, saved: 0, applied: 0, dismissed: 0, unread: 3, excluded: 0 },
};

export class SilentEventSource {
  static readonly CLOSED = 2;
  readyState = 1;
  onmessage = null;
  onerror = null;
  addEventListener() {}
  close() {}
}

export function renderApp(path: string) {
  vi.stubGlobal('EventSource', SilentEventSource);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const history = createMemoryHistory({ initialEntries: [path] });
  const utils = render(<App queryClient={queryClient} history={history} />);
  return { ...utils, queryClient, history };
}
