import { useEffect } from 'react';
import { useQueryClient, type InfiniteData, type QueryClient, type QueryKey } from '@tanstack/react-query';
import type { PostingDetail, PostingListItem, PostingListResponse, ServerEvent } from '../../../shared/api';
import { createStore } from '../lib/store';
import { ApiRequestError, apiPath } from './client';
import { api } from './endpoints';
import { qk } from './keys';

/**
 * Live updates. The server pushes `ServerEvent`s on `/api/events`.
 *
 * Detail queries and side data are invalidated. Rows of the job list are refreshed in the cache. When a
 * score arrives, the row also moves to its new rank among the loaded rows. New postings, profile
 * changes, and scores for postings that are not loaded refetch the job list, at most once in each
 * `LIST_REFRESH_MS`. The job page keeps the cursor on its posting when the order changes.
 */

export interface EventEffects {
  invalidate: QueryKey[];
  /** Postings whose list rows are refreshed in place. */
  patchPostings: string[];
  /** The list may hold new rows or a new order, so it is fetched again. */
  refreshList: boolean;
}

export function effectsFor(event: ServerEvent): EventEffects {
  switch (event.type) {
    case 'run.progress':
      return { invalidate: [qk.status, qk.runs, qk.activity, qk.sources, qk.clearPreview], patchPostings: [], refreshList: false };
    case 'posting.added':
      return { invalidate: [qk.status, qk.clearPreview], patchPostings: [], refreshList: true };
    case 'posting.updated':
      return { invalidate: [qk.posting(event.postingId), qk.status, qk.clearPreview], patchPostings: [event.postingId], refreshList: false };
    case 'match.updated':
      return { invalidate: [qk.posting(event.postingId), qk.status], patchPostings: [event.postingId], refreshList: false };
    case 'queue.changed':
      return { invalidate: [qk.status, qk.activity], patchPostings: [], refreshList: false };
    case 'llm.status':
      return { invalidate: [qk.status, qk.llm], patchPostings: [], refreshList: false };
    case 'profile.updated':
      return { invalidate: [qk.profile, qk.status], patchPostings: [], refreshList: true };
    case 'application.updated':
      return {
        invalidate: [qk.applications, qk.applicationEvents(event.postingId), qk.posting(event.postingId), qk.status, qk.clearPreview],
        patchPostings: [event.postingId],
        refreshList: false,
      };
    case 'postings.cleared':
      // Every open detail may show a posting that is gone. The list loses its rows through the refetch. The new backup and
      // the log line show on every open page, so another device sees the backup it may need.
      return { invalidate: [qk.status, qk.activity, qk.postingAll, qk.clearPreview, qk.backups, qk.logsAll], patchPostings: [], refreshList: true };
    default:
      return { invalidate: [], patchPostings: [], refreshList: false };
  }
}

// ---- Shared live state

export const connectionStore = createStore<'connecting' | 'open' | 'closed'>('connecting');

// ---- List refetch

/** The shortest time between two automatic refetches of the job list. */
export const LIST_REFRESH_MS = 3000;

/**
 * Refetches every cached job list, at most once in each `minGapMs`. A refetch waits while a mutation runs,
 * so that it does not undo an optimistic change, such as a dismissed row.
 */
export function createListRefresher(qc: QueryClient, minGapMs = LIST_REFRESH_MS) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let last = 0;

  const run = () => {
    timer = null;
    if (qc.isMutating() > 0) {
      timer = setTimeout(run, 500);
      return;
    }
    last = Date.now();
    void qc.invalidateQueries({ queryKey: qk.postingsAll });
  };

  return {
    request() {
      if (timer) return;
      timer = setTimeout(run, Math.max(0, last + minGapMs - Date.now()));
    },
    cancel() {
      if (timer) clearTimeout(timer);
      timer = null;
    },
  };
}

// ---- In-place row updates

type ListData = InfiniteData<PostingListResponse, number>;

export function detailToListItem(d: PostingDetail): PostingListItem {
  return {
    id: d.id,
    title: d.title,
    company: d.company,
    location: d.location,
    source: d.source,
    sources: d.sources,
    url: d.url,
    postedAt: d.postedAt,
    firstSeenAt: d.firstSeenAt,
    triageStatus: d.triageStatus,
    triageOrigin: d.triageOrigin,
    unread: d.unread,
    linkStatus: d.linkStatus,
    lacksDescription: d.lacksDescription,
    duplicateOf: d.duplicateOf,
    workArrangement: d.workArrangement,
    tags: d.tags,
    match: d.match
      ? { state: d.match.state, totalScore: d.match.totalScore, stale: d.match.stale, excludedReason: d.match.excludedReason }
      : null,
    analysis: d.matchAnalysis ? { state: d.matchAnalysis.state, verdict: d.matchAnalysis.content?.verdict ?? null } : null,
  };
}

/** Applies `fn` to the item with `id` in every cached list. `fn` returning null removes the row. */
export function updateListItems(qc: QueryClient, id: string, fn: (item: PostingListItem) => PostingListItem | null): void {
  qc.setQueriesData<ListData>({ queryKey: qk.postingsAll }, (data) => {
    if (!data) return data;
    let changed = false;
    let removed = 0;
    const pages = data.pages.map((page) => {
      if (!page.items.some((i) => i.id === id)) return page;
      changed = true;
      const items: PostingListItem[] = [];
      for (const item of page.items) {
        if (item.id !== id) {
          items.push(item);
          continue;
        }
        const next = fn(item);
        if (next) items.push(next);
        else removed++;
      }
      return { ...page, items };
    });
    if (!changed) return data;
    return { ...data, pages: removed ? pages.map((p) => ({ ...p, total: Math.max(0, p.total - removed) })) : pages };
  });
}

/** The ranking order of the server: scored postings first, then score, then date, then id. */
export function byRanking(a: PostingListItem, b: PostingListItem): number {
  const sa = a.match?.totalScore ?? null;
  const sb = b.match?.totalScore ?? null;
  if ((sa === null) !== (sb === null)) return sa === null ? 1 : -1;
  if (sa !== null && sb !== null && sa !== sb) return sb - sa;
  const da = a.postedAt ?? a.firstSeenAt;
  const db = b.postedAt ?? b.firstSeenAt;
  if (da !== db) return da < db ? 1 : -1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * Moves the item with `id` to its rank in every cached list that is in ranking order. The other items keep
 * the order that the server gave them, and each page keeps its length.
 */
export function moveToRank(qc: QueryClient, id: string): void {
  for (const [key, data] of qc.getQueriesData<ListData>({ queryKey: qk.postingsAll })) {
    if (!data || (key[1] as { sort?: string } | undefined)?.sort !== 'score') continue;
    const flat = data.pages.flatMap((p) => p.items);
    const from = flat.findIndex((i) => i.id === id);
    if (from < 0) continue;
    const [moved] = flat.splice(from, 1);
    if (!moved) continue;
    const before = flat.findIndex((other) => byRanking(moved, other) < 0);
    const to = before < 0 ? flat.length : before;
    if (to === from) continue;
    flat.splice(to, 0, moved);
    let offset = 0;
    const pages = data.pages.map((page) => {
      const items = flat.slice(offset, offset + page.items.length);
      offset += page.items.length;
      return { ...page, items };
    });
    qc.setQueryData<ListData>(key, { ...data, pages });
  }
}

export function isInCachedLists(qc: QueryClient, id: string): boolean {
  return qc
    .getQueriesData<ListData>({ queryKey: qk.postingsAll })
    .some(([, data]) => data?.pages.some((p) => p.items.some((i) => i.id === id)) ?? false);
}

/** Collects posting ids for a short window, then refreshes each cached row from the detail route. */
export function createRowPatcher(qc: QueryClient, delayMs = 250, onListChanged: () => void = () => {}) {
  const pending = new Set<string>();
  const scored = new Set<string>();
  let timer: ReturnType<typeof setTimeout> | null = null;

  async function flush(): Promise<void> {
    timer = null;
    const all = [...pending];
    const ids = all.filter((id) => isInCachedLists(qc, id));
    const scoredOutside = all.some((id) => scored.has(id) && !ids.includes(id));
    const wasScored = new Set(scored);
    pending.clear();
    scored.clear();
    // A score for a posting that is not loaded can move it into the loaded rows. Only a refetch shows that.
    if (scoredOutside) onListChanged();
    await Promise.all(
      ids.map(async (id) => {
        try {
          const detail = await api.posting(id);
          qc.setQueryData(qk.posting(id), detail);
          updateListItems(qc, id, () => detailToListItem(detail));
          // A new score changes the rank, so the card moves.
          if (wasScored.has(id)) moveToRank(qc, id);
        } catch (err) {
          if (err instanceof ApiRequestError && err.status === 404) updateListItems(qc, id, () => null);
        }
      }),
    );
  }

  return {
    add(ids: string[], isScore = false) {
      for (const id of ids) {
        pending.add(id);
        if (isScore) scored.add(id);
      }
      if (!timer && pending.size) timer = setTimeout(() => void flush(), delayMs);
    },
    flush,
    cancel() {
      if (timer) clearTimeout(timer);
      timer = null;
      pending.clear();
      scored.clear();
    },
  };
}

export function applyServerEvent(
  qc: QueryClient,
  event: ServerEvent,
  patcher: { add: (ids: string[], isScore?: boolean) => void },
  list: { request: () => void },
): EventEffects {
  const fx = effectsFor(event);
  for (const key of fx.invalidate) void qc.invalidateQueries({ queryKey: key });
  if (fx.patchPostings.length) patcher.add(fx.patchPostings, event.type === 'match.updated');
  if (fx.refreshList) list.request();
  return fx;
}

function parseEvent(data: string): ServerEvent | null {
  try {
    const value = JSON.parse(data) as unknown;
    if (value && typeof value === 'object' && typeof (value as { type?: unknown }).type === 'string') return value as ServerEvent;
  } catch {
    // Ignore a malformed message.
  }
  return null;
}

/**
 * Opens one EventSource on `/api/events`. On every reconnect after the first `ready` event,
 * all queries refetch, because events may have been missed while the connection was down.
 */
export function useServerEvents(enabled: boolean, reconnectDelayMs = 5000): void {
  const qc = useQueryClient();
  useEffect(() => {
    if (!enabled || typeof EventSource === 'undefined') return;
    const list = createListRefresher(qc);
    const patcher = createRowPatcher(qc, 250, () => list.request());
    let source: EventSource | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let readyBefore = false;
    let disposed = false;

    const connect = () => {
      connectionStore.set('connecting');
      const es = new EventSource(apiPath('/api/events'));
      source = es;
      es.addEventListener('ready', () => {
        connectionStore.set('open');
        if (readyBefore) void qc.invalidateQueries();
        readyBefore = true;
      });
      es.onmessage = (msg: MessageEvent<string>) => {
        const event = parseEvent(msg.data);
        if (event) applyServerEvent(qc, event, patcher, list);
      };
      es.onerror = () => {
        connectionStore.set('closed');
        // The browser retries by itself unless the stream closed for good, for example after a 401.
        if (es.readyState === EventSource.CLOSED && !disposed) {
          es.close();
          void qc.invalidateQueries({ queryKey: qk.auth });
          retry = setTimeout(connect, reconnectDelayMs);
        }
      };
    };
    connect();

    return () => {
      disposed = true;
      if (retry) clearTimeout(retry);
      source?.close();
      patcher.cancel();
      list.cancel();
    };
  }, [enabled, qc, reconnectDelayMs]);
}
