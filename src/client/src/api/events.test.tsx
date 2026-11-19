import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider, type InfiniteData } from '@tanstack/react-query';
import { act, render } from '@testing-library/react';
import type { PostingListItem, PostingListResponse, ServerEvent } from '../../../shared/api';
import { applyServerEvent, connectionStore, createListRefresher, createRowPatcher, effectsFor, useServerEvents } from './events';
import { qk } from './keys';

describe('effectsFor: SSE event to query invalidation', () => {
  const cases: Array<[ServerEvent, unknown[][], string[], boolean]> = [
    [{ type: 'run.progress', runId: 1 }, [['status'], ['runs'], ['activity'], ['sources']], [], false],
    [{ type: 'posting.added', postingId: 'p1' }, [['status']], [], true],
    [{ type: 'posting.updated', postingId: 'p1' }, [['posting', 'p1'], ['status']], ['p1'], false],
    [{ type: 'match.updated', postingId: 'p1' }, [['posting', 'p1'], ['status']], ['p1'], false],
    [{ type: 'queue.changed' }, [['status'], ['activity']], [], false],
    [{ type: 'llm.status', available: false }, [['status'], ['llm']], [], false],
    [{ type: 'profile.updated' }, [['profile'], ['status']], [], true],
    [{ type: 'application.updated', postingId: 'p1' }, [['applications'], ['application-events', 'p1'], ['posting', 'p1'], ['status']], ['p1'], false],
  ];

  it.each(cases)('maps %o', (event, keys, patch, refresh) => {
    const fx = effectsFor(event);
    expect(fx.invalidate).toEqual(keys);
    expect(fx.patchPostings).toEqual(patch);
    expect(fx.refreshList).toBe(refresh);
  });

  it('never invalidates the job list directly, so the list refetches only through the throttled refresher', () => {
    for (const [event] of cases) {
      expect(effectsFor(event).invalidate.some((k) => k[0] === 'postings')).toBe(false);
    }
  });
});

describe('applyServerEvent', () => {
  it('invalidates each key, queues row patches, and requests a list refetch for new postings', () => {
    const qc = new QueryClient();
    const spy = vi.spyOn(qc, 'invalidateQueries');
    const patcher = { add: vi.fn() };
    const list = { request: vi.fn() };
    applyServerEvent(qc, { type: 'match.updated', postingId: 'p9' }, patcher, list);
    expect(spy).toHaveBeenCalledWith({ queryKey: ['posting', 'p9'] });
    expect(spy).toHaveBeenCalledWith({ queryKey: ['status'] });
    expect(patcher.add).toHaveBeenCalledWith(['p9'], true);
    expect(list.request).not.toHaveBeenCalled();

    applyServerEvent(qc, { type: 'posting.added', postingId: 'n1' }, patcher, list);
    applyServerEvent(qc, { type: 'posting.added', postingId: 'n2' }, patcher, list);
    expect(list.request).toHaveBeenCalledTimes(2);
  });
});

describe('list refresher', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('refetches the job lists at most once in each interval', () => {
    const qc = new QueryClient();
    const spy = vi.spyOn(qc, 'invalidateQueries');
    const list = createListRefresher(qc, 1000);
    list.request();
    list.request();
    vi.advanceTimersByTime(0);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith({ queryKey: ['postings'] });

    list.request();
    list.request();
    vi.advanceTimersByTime(500);
    expect(spy).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(500);
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('waits while a mutation runs', () => {
    const qc = new QueryClient();
    const spy = vi.spyOn(qc, 'invalidateQueries');
    const mutating = vi.spyOn(qc, 'isMutating').mockReturnValue(1);
    const list = createListRefresher(qc, 1000);
    list.request();
    vi.advanceTimersByTime(1500);
    expect(spy).not.toHaveBeenCalled();
    mutating.mockReturnValue(0);
    vi.advanceTimersByTime(500);
    expect(spy).toHaveBeenCalledTimes(1);
  });
});

function item(id: string, score: number | null): PostingListItem {
  return {
    id, title: `Job ${id}`, company: 'Acme', location: null, source: 'remotive', sources: ['remotive'], url: 'https://x', postedAt: null,
    firstSeenAt: '2026-11-01T00:00:00Z', triageStatus: 'new', triageOrigin: null, unread: true, linkStatus: 'active', lacksDescription: false,
    duplicateOf: null, workArrangement: null, tags: [], match: score === null ? null : { state: 'scored', totalScore: score, stale: false, excludedReason: null },
  };
}

describe('row patcher', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('updates a scored row in place without changing its position', async () => {
    const qc = new QueryClient();
    const key = qk.postings({ status: 'new,saved', sort: 'score' });
    qc.setQueryData<InfiniteData<PostingListResponse, number>>(key, {
      pages: [{ items: [item('a', 90), item('b', null), item('c', 40)], total: 3, nextOffset: null }],
      pageParams: [0],
    });
    const detail = { ...item('b', 95), description: null, facts: null, sourceLinks: [], application: null,
      match: { state: 'scored', totalScore: 95, stale: false, excludedReason: null, failReason: null, skillsScore: 1, experienceScore: 1,
        preferenceScore: 1, locationScore: 1, matchedSkills: [], missingSkills: [], assessment: 'ok', softViolations: [], provider: null, model: null } };
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(detail), { status: 200 })));
    const patcher = createRowPatcher(qc, 0);
    patcher.add(['b', 'not-cached']);
    await patcher.flush();
    const data = qc.getQueryData<InfiniteData<PostingListResponse, number>>(key)!;
    expect(data.pages[0]!.items.map((i) => i.id)).toEqual(['a', 'b', 'c']);
    expect(data.pages[0]!.items[1]!.match?.totalScore).toBe(95);
    // Only the cached posting is fetched.
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('moves a row to its rank when a score arrives, and keeps the page lengths', async () => {
    const qc = new QueryClient();
    const key = qk.postings({ status: 'new,saved', sort: 'score' });
    const newest = qk.postings({ status: 'new,saved', sort: 'newest' });
    const pages = () => [
      { items: [item('a', 90), item('b', 40)], total: 4, nextOffset: 2 },
      { items: [item('c', null), item('d', null)], total: 4, nextOffset: null },
    ];
    qc.setQueryData<InfiniteData<PostingListResponse, number>>(key, { pages: pages(), pageParams: [0, 2] });
    qc.setQueryData<InfiniteData<PostingListResponse, number>>(newest, { pages: pages(), pageParams: [0, 2] });
    const detail = { ...item('d', 70), description: null, facts: null, sourceLinks: [], application: null,
      match: { state: 'scored', totalScore: 70, stale: false, excludedReason: null, failReason: null, skillsScore: 1, experienceScore: 1,
        preferenceScore: 1, locationScore: 1, matchedSkills: [], missingSkills: [], assessment: 'ok', softViolations: [], provider: null, model: null } };
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(detail), { status: 200 })));
    const patcher = createRowPatcher(qc, 0);
    patcher.add(['d'], true);
    await patcher.flush();
    const ids = (k: typeof key | typeof newest) => qc.getQueryData<InfiniteData<PostingListResponse, number>>(k)!.pages.map((p) => p.items.map((i) => i.id));
    expect(ids(key)).toEqual([['a', 'd'], ['b', 'c']]);
    // A list in date order keeps its order.
    expect(ids(newest)).toEqual([['a', 'b'], ['c', 'd']]);
  });

  it('requests a list refetch when a score arrives for a posting that is not loaded', async () => {
    const qc = new QueryClient();
    qc.setQueryData<InfiniteData<PostingListResponse, number>>(qk.postings({ status: 'new,saved', sort: 'score' }), {
      pages: [{ items: [item('a', 90)], total: 9, nextOffset: 1 }],
      pageParams: [0],
    });
    vi.stubGlobal('fetch', vi.fn());
    const onListChanged = vi.fn();
    const patcher = createRowPatcher(qc, 0, onListChanged);
    patcher.add(['far'], true);
    await patcher.flush();
    expect(onListChanged).toHaveBeenCalledTimes(1);
    expect(fetch).not.toHaveBeenCalled();
  });
});

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  static readonly CLOSED = 2;
  readyState = 1;
  onmessage: ((e: MessageEvent<string>) => void) | null = null;
  onerror: (() => void) | null = null;
  listeners = new Map<string, Array<() => void>>();
  constructor(public url: string) {
    FakeEventSource.instances.push(this);
  }
  addEventListener(type: string, fn: () => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]);
  }
  emit(type: string) {
    for (const fn of this.listeners.get(type) ?? []) fn();
  }
  send(event: ServerEvent) {
    this.onmessage?.(new MessageEvent('message', { data: JSON.stringify(event) }));
  }
  close() {
    this.readyState = 2;
  }
}

function Harness() {
  useServerEvents(true, 10);
  return null;
}

describe('useServerEvents', () => {
  beforeEach(() => {
    FakeEventSource.instances = [];
    vi.stubGlobal('EventSource', FakeEventSource);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('applies events and refetches everything after a reconnect', () => {
    const qc = new QueryClient();
    const spy = vi.spyOn(qc, 'invalidateQueries');
    render(
      <QueryClientProvider client={qc}>
        <Harness />
      </QueryClientProvider>,
    );
    const es = FakeEventSource.instances[0]!;
    expect(es.url).toBe('/api/events');

    act(() => es.emit('ready'));
    expect(connectionStore.get()).toBe('open');
    expect(spy).not.toHaveBeenCalled();

    act(() => es.send({ type: 'llm.status', available: true }));
    expect(spy).toHaveBeenCalledWith({ queryKey: ['llm'] });

    // The browser reconnects by itself and the server sends `ready` again.
    spy.mockClear();
    act(() => es.onerror?.());
    expect(connectionStore.get()).toBe('closed');
    act(() => es.emit('ready'));
    expect(spy).toHaveBeenCalledWith();
  });

  it('opens a new connection when the stream closed for good', async () => {
    const qc = new QueryClient();
    render(
      <QueryClientProvider client={qc}>
        <Harness />
      </QueryClientProvider>,
    );
    const es = FakeEventSource.instances[0]!;
    es.readyState = FakeEventSource.CLOSED;
    act(() => es.onerror?.());
    await act(() => new Promise((r) => setTimeout(r, 30)));
    expect(FakeEventSource.instances).toHaveLength(2);
  });
});
