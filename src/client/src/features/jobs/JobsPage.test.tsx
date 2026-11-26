import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryHistory } from '@tanstack/react-router';
import { QueryClient } from '@tanstack/react-query';
import type { MatchSummary, PostingDetail, PostingListItem, ServerEvent } from '../../../../shared/api';
import { App } from '../../app/App';
import { STATUS, makeItem, mockApi, renderApp } from '../../test-utils';
import { resetToastsForTests, showUndoToast } from '../../lib/toast';
import { mockMedia } from '../../test/media';

function rowOf(title: string): HTMLElement {
  return screen.getByText(title).closest('[role="listitem"]') as HTMLElement;
}

/** The card of this title in the job list. The detail view may show the same title as a heading. */
function cardOf(title: string): HTMLElement {
  const list = screen.getByRole('list', { name: /Job postings/ });
  return within(list).getByText(title).closest('[role="listitem"]') as HTMLElement;
}

function excludedMatch(excludedReason: string, totalScore: number | null = null): MatchSummary {
  return { state: 'excluded', totalScore, stale: false, excludedReason };
}

function detailOf(item: PostingListItem, extra: Partial<PostingDetail> = {}): PostingDetail {
  return {
    ...item,
    description: 'Build things.',
    facts: null,
    sourceLinks: [],
    application: null,
    match: null,
    coverLetter: null,
    matchAnalysis: null,
    ...extra,
  };
}

/** An event stream that the test writes to, as the server does. */
class FakeEventSource {
  static instances: FakeEventSource[] = [];
  static readonly CLOSED = 2;
  readyState = 1;
  onmessage: ((e: MessageEvent<string>) => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(public url: string) {
    FakeEventSource.instances.push(this);
  }
  addEventListener() {}
  send(event: ServerEvent) {
    this.onmessage?.(new MessageEvent('message', { data: JSON.stringify(event) }));
  }
  close() {
    this.readyState = 2;
  }
}

function baseRoutes(items: () => PostingListItem[]) {
  return {
    'GET /api/auth/me': () => ({ authRequired: false, authenticated: true }),
    'GET /api/status': () => STATUS,
    'GET /api/sources': () => [],
    'GET /api/postings': () => ({ items: items(), total: items().length, nextOffset: null }),
  };
}

describe('jobs view', () => {
  beforeEach(() => resetToastsForTests());
  afterEach(() => {
    vi.unstubAllGlobals();
    resetToastsForTests();
  });

  it('moves through the list with j and k and saves with s, keeping focus in the list', async () => {
    const items = [makeItem('1', 90), makeItem('2', 70), makeItem('3', 40)];
    const api = mockApi({
      ...baseRoutes(() => items),
      'POST /api/postings/bulk': () => ({ previous: [{ id: '2', triageStatus: 'new' }] }),
    });
    const user = userEvent.setup();
    renderApp('/jobs');
    await screen.findByText('Job 1');

    expect(rowOf('Job 1')).toHaveAttribute('aria-current', 'true');
    await user.keyboard('j');
    expect(rowOf('Job 2')).toHaveAttribute('aria-current', 'true');
    expect(rowOf('Job 1')).not.toHaveAttribute('aria-current');
    await user.keyboard('j');
    expect(rowOf('Job 3')).toHaveAttribute('aria-current', 'true');
    // The cursor stops at the end.
    await user.keyboard('j');
    expect(rowOf('Job 3')).toHaveAttribute('aria-current', 'true');
    await user.keyboard('k');
    expect(rowOf('Job 2')).toHaveAttribute('aria-current', 'true');

    await user.keyboard('s');
    await waitFor(() => expect(api.calls.some((c) => c.method === 'POST' && c.path === '/api/postings/bulk')).toBe(true));
    const call = api.calls.find((c) => c.path === '/api/postings/bulk')!;
    expect(call.body).toEqual({ ids: ['2'], action: 'save' });
    // Saved postings stay in the default list, with a status badge, and focus stays in the list.
    await waitFor(() => expect(within(rowOf('Job 2')).getAllByText('Saved').length).toBeGreaterThan(0));
    expect(screen.getByRole('list', { name: /Job postings/ })).toContainElement(document.activeElement as HTMLElement);
  });

  it('shows the score with a text label, not only a color', async () => {
    mockApi(baseRoutes(() => [makeItem('1', 90), makeItem('2', null, { match: { state: 'scored', totalScore: 55, stale: true, excludedReason: null } })]));
    renderApp('/jobs');
    await screen.findByText('Job 1');
    expect(within(rowOf('Job 1')).getByText('Strong match')).toBeInTheDocument();
    expect(within(rowOf('Job 2')).getByText('Possible match')).toBeInTheDocument();
    expect(within(rowOf('Job 2')).getByText('Stale')).toBeInTheDocument();
  });

  it('dismisses with d, removes the row, and undo posts the previous statuses to /api/postings/restore', async () => {
    let items = [makeItem('1', 90), makeItem('2', 70)];
    const api = mockApi({
      ...baseRoutes(() => items),
      'POST /api/postings/bulk': (c) => {
        const ids = (c.body as { ids: string[] }).ids;
        items = items.filter((i) => !ids.includes(i.id));
        return { previous: ids.map((id) => ({ id, triageStatus: 'new' })) };
      },
      'POST /api/postings/restore': () => {
        items = [makeItem('1', 90), makeItem('2', 70)];
        return { ok: true };
      },
    });
    const user = userEvent.setup();
    renderApp('/jobs');
    await screen.findByText('Job 1');

    await user.keyboard('d');
    await waitFor(() => expect(screen.queryByText('Job 1')).not.toBeInTheDocument());
    const toast = await screen.findByText(/Dismissed “Job 1”/);
    await user.click(within(toast.closest('[role="status"]') as HTMLElement).getByRole('button', { name: 'Undo' }));

    await waitFor(() => {
      const restore = api.calls.find((c) => c.path === '/api/postings/restore');
      expect(restore?.body).toEqual({ previous: [{ id: '1', triageStatus: 'new' }] });
    });
    // The list reloads and the posting is back.
    expect(await screen.findByText('Job 1')).toBeInTheDocument();
  });

  it('undoes the last action with the u key', async () => {
    let items = [makeItem('1', 90), makeItem('2', 70)];
    const api = mockApi({
      ...baseRoutes(() => items),
      'POST /api/postings/bulk': () => {
        items = [makeItem('2', 70)];
        return { previous: [{ id: '1', triageStatus: 'saved' }] };
      },
      'POST /api/postings/restore': () => ({ ok: true }),
    });
    const user = userEvent.setup();
    renderApp('/jobs');
    await screen.findByText('Job 1');
    await user.keyboard('d');
    await screen.findByText(/Dismissed “Job 1”/);
    await user.keyboard('u');
    await waitFor(() => expect(api.calls.find((c) => c.path === '/api/postings/restore')?.body).toEqual({ previous: [{ id: '1', triageStatus: 'saved' }] }));
  });

  it('puts the row back and reports the error when the server rejects the action', async () => {
    mockApi({
      ...baseRoutes(() => [makeItem('1', 90), makeItem('2', 70)]),
      'POST /api/postings/bulk': () => new Response(JSON.stringify({ error: 'Database is locked.' }), { status: 500 }),
    });
    const user = userEvent.setup();
    renderApp('/jobs');
    await screen.findByText('Job 1');
    await user.keyboard('d');
    expect(await screen.findByText(/Database is locked/)).toBeInTheDocument();
    expect(screen.getByText('Job 1')).toBeInTheDocument();
  });

  it('dismisses a selection with one undo for the group', async () => {
    const items = ['1', '2', '3', '4', '5', '6'].map((id, i) => makeItem(id, 90 - i));
    const api = mockApi({
      ...baseRoutes(() => items),
      'POST /api/postings/bulk': (c) => ({ previous: (c.body as { ids: string[] }).ids.map((id) => ({ id, triageStatus: 'new' })) }),
      'POST /api/postings/restore': () => ({ ok: true }),
    });
    const user = userEvent.setup();
    renderApp('/jobs');
    await screen.findByText('Job 1');
    for (let i = 0; i < 5; i++) {
      await user.keyboard('x');
      await user.keyboard('j');
    }
    expect(screen.getByText('5 selected')).toBeInTheDocument();
    await user.click(within(screen.getByRole('toolbar', { name: 'Bulk actions' })).getByRole('button', { name: 'Dismiss' }));
    const toast = await screen.findByText(/Dismissed 5 postings/);

    // One request dismisses all five, and all five leave the default list.
    const bulk = api.calls.filter((c) => c.path === '/api/postings/bulk');
    expect(bulk).toHaveLength(1);
    expect(bulk[0]!.body).toEqual({ ids: ['1', '2', '3', '4', '5'], action: 'dismiss' });
    for (const n of [1, 2, 3, 4, 5]) expect(screen.queryByText(`Job ${n}`)).not.toBeInTheDocument();
    expect(screen.getByText('Job 6')).toBeInTheDocument();

    // One undo action covers the group.
    expect(screen.getAllByRole('button', { name: 'Undo' })).toHaveLength(1);
    await user.click(within(toast.closest('[role="status"]') as HTMLElement).getByRole('button', { name: 'Undo' }));
    await waitFor(() =>
      expect(api.calls.filter((c) => c.path === '/api/postings/restore').map((c) => c.body)).toEqual([
        { previous: ['1', '2', '3', '4', '5'].map((id) => ({ id, triageStatus: 'new' })) },
      ]),
    );
  });

  it('opens the detail from ?id= and marks the posting as read', async () => {
    const item = makeItem('7', 82, { linkStatus: 'expired' });
    const api = mockApi({
      ...baseRoutes(() => [item]),
      'GET /api/postings/7': () => ({
        ...item,
        description: 'Build things.',
        facts: null,
        sourceLinks: [{ id: '7', source: 'jobindex', url: item.url, primary: true }],
        application: null,
        match: {
          state: 'scored',
          totalScore: 82,
          stale: false,
          excludedReason: null,
          failReason: null,
          skillsScore: 90,
          experienceScore: 80,
          preferenceScore: 70,
          locationScore: 60,
          matchedSkills: ['React'],
          missingSkills: ['Go'],
          assessment: 'Good fit.',
          softViolations: [],
          provider: 'local',
          model: 'm',
        },
      }),
      'PATCH /api/postings/7': () => ({ previous: [] }),
    });
    renderApp('/jobs?id=7');
    expect(await screen.findByRole('heading', { name: 'Job 7' })).toBeInTheDocument();
    expect(screen.getByText(/may no longer be available/)).toBeInTheDocument();
    expect(screen.getByText('Good fit.')).toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'Missing skills' })).toHaveTextContent('Go');
    await waitFor(() => expect(api.calls.find((c) => c.method === 'PATCH' && c.path === '/api/postings/7')?.body).toEqual({ read: true }));
  });

  it('shows the same filters and the same posting after a reload of the address', async () => {
    const item = makeItem('7', 82);
    const queries: string[] = [];
    mockApi({
      ...baseRoutes(() => [item]),
      'GET /api/postings': (_c, url) => {
        queries.push(url.search);
        return { items: [item], total: 1, nextOffset: null };
      },
      'GET /api/postings/7': () => ({
        ...item,
        description: 'Build things.',
        facts: null,
        sourceLinks: [],
        application: null,
        match: null,
        coverLetter: null,
        matchAnalysis: null,
      }),
      'PATCH /api/postings/7': () => ({ previous: [] }),
    });
    const { history } = renderApp('/jobs?id=7&work=remote&minScore=70');

    // The selected posting is open.
    expect(await screen.findByRole('heading', { name: 'Job 7' })).toBeInTheDocument();
    expect(within(screen.getByRole('complementary', { name: 'Posting details' })).getByText('Build things.')).toBeInTheDocument();

    // The list request has both filters.
    expect(queries.length).toBeGreaterThan(0);
    for (const q of queries) {
      const params = new URLSearchParams(q);
      expect(params.get('work')).toBe('remote');
      expect(params.get('minScore')).toBe('70');
    }

    // The filter controls are visible and show both filters.
    const work = screen.getByLabelText('Work arrangement');
    const minScore = screen.getByLabelText('Minimum score');
    expect(work).toBeVisible();
    expect(work).toHaveValue('remote');
    expect(minScore).toBeVisible();
    expect(minScore).toHaveValue('70');
    expect(screen.getByRole('button', { name: /Filters/ })).toHaveAttribute('aria-expanded', 'true');
    expect(history.location.search).toBe('?id=7&work=remote&minScore=70');
  });

  it('shows an empty state that clears the filters', async () => {
    mockApi(baseRoutes(() => []));
    const user = userEvent.setup();
    const { history } = renderApp('/jobs?minScore=90&work=remote');
    const empty = await screen.findByText('No postings match these filters.');
    await user.click(within(empty.parentElement as HTMLElement).getByRole('button', { name: 'Clear filters' }));
    await waitFor(() => expect(history.location.search).toBe(''));
  });

  it('names the applied and dismissed postings that the default list hides, and lists them on request', async () => {
    const all = [makeItem('a1', 80, { triageStatus: 'applied' }), makeItem('d1', 60, { triageStatus: 'dismissed' })];
    const api = mockApi({
      ...baseRoutes(() => []),
      'GET /api/postings': (_call, url) => {
        const items = url.searchParams.get('status') === 'all' ? all : [];
        return { items, total: items.length, nextOffset: null };
      },
      'GET /api/status': () => ({ ...STATUS, counts: { ...STATUS.counts, new: 0, unread: 0, applied: 3, dismissed: 2 } }),
    });
    const user = userEvent.setup();
    const { history } = renderApp('/jobs');

    const empty = await screen.findByText('No new or saved postings.');
    const box = within(empty.parentElement as HTMLElement);
    expect(box.getByText('3 applied and 2 dismissed postings are hidden. New ones appear here after the next fetch.')).toBeInTheDocument();
    await user.click(box.getByRole('button', { name: 'Show every status' }));

    await waitFor(() => expect(history.location.search).toBe('?status=all'));
    expect(await screen.findByText('Job a1')).toBeInTheDocument();
    expect(screen.getByText('Job d1')).toBeInTheDocument();
    expect(api.calls.some((c) => c.path === '/api/postings')).toBe(true);
  });

  it.each([
    [1, 0, '1 applied posting is hidden.'],
    [3, 0, '3 applied postings are hidden.'],
    [0, 1, '1 dismissed posting is hidden.'],
    [0, 4, '4 dismissed postings are hidden.'],
    [1, 1, '1 applied and 1 dismissed postings are hidden.'],
  ])('names %i applied and %i dismissed hidden postings as "%s"', async (applied, dismissed, text) => {
    mockApi({ ...baseRoutes(() => []), 'GET /api/status': () => ({ ...STATUS, counts: { ...STATUS.counts, new: 0, unread: 0, applied, dismissed } }) });
    renderApp('/jobs');
    expect(await screen.findByText(`${text} New ones appear here after the next fetch.`)).toBeInTheDocument();
  });

  it('asks for a CV and search terms instead of promising a fetch when fetching cannot find postings', async () => {
    mockApi({
      ...baseRoutes(() => []),
      'GET /api/status': () => ({ ...STATUS, hasCv: false, searchTermCount: 0, counts: { ...STATUS.counts, new: 0, unread: 0, applied: 2 } }),
    });
    renderApp('/jobs');
    expect(
      await screen.findByText('2 applied postings are hidden. Add a CV and search terms, then fetch jobs with the button in the status bar.'),
    ).toBeInTheDocument();
  });

  it('says no postings exist yet when the default list hides none', async () => {
    mockApi({ ...baseRoutes(() => []), 'GET /api/status': () => ({ ...STATUS, counts: { ...STATUS.counts, new: 0, unread: 0 } }) });
    renderApp('/jobs');
    expect(await screen.findByText('No postings yet.')).toBeInTheDocument();
  });

  it('writes filter changes to the URL', async () => {
    mockApi(baseRoutes(() => [makeItem('1', 90)]));
    const user = userEvent.setup();
    const { history } = renderApp('/jobs');
    await screen.findByText('Job 1');
    await user.click(screen.getByRole('button', { name: /Filters/ }));
    await user.selectOptions(screen.getByLabelText('Work arrangement'), 'remote');
    await user.selectOptions(screen.getByLabelText('Minimum score'), '70');
    await waitFor(() => expect(history.location.search).toBe('?work=remote&minScore=70'));
  });

  it('shows excluded postings with the reason for each when the user enables them', async () => {
    const visible = [makeItem('1', 90)];
    const excluded = [makeItem('2', null, { match: excludedMatch('excluded company') }), makeItem('3', 20, { match: excludedMatch('language: German', 20) })];
    mockApi({
      ...baseRoutes(() => visible),
      'GET /api/postings': (_c, url) => {
        const items = url.searchParams.has('showExcluded') ? [...visible, ...excluded] : visible;
        return { items, total: items.length, nextOffset: null };
      },
    });
    const user = userEvent.setup();
    const { history } = renderApp('/jobs');
    await screen.findByText('Job 1');
    expect(screen.queryByText('Job 2')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Filters/ }));
    await user.click(screen.getByRole('checkbox', { name: 'Show excluded' }));
    await waitFor(() => expect(history.location.search).toBe('?showExcluded=1'));
    await screen.findByText('Job 2');
    expect(within(cardOf('Job 2')).getByText('Excluded: excluded company')).toBeInTheDocument();
    expect(within(cardOf('Job 3')).getByText('Excluded: language: German')).toBeInTheDocument();
  });

  it('asks for each hidden group when the user enables it and shows its postings', async () => {
    const primary = makeItem('1', 90);
    const dismissed = makeItem('2', 80, { triageStatus: 'dismissed' });
    const excluded = makeItem('3', null, { match: excludedMatch('excluded company') });
    const duplicate = makeItem('4', 70, { duplicateOf: '1' });
    const queries: URLSearchParams[] = [];
    mockApi({
      ...baseRoutes(() => [primary]),
      'GET /api/postings': (_c, url) => {
        queries.push(url.searchParams);
        const items = [primary];
        if (url.searchParams.get('status')?.split(',').includes('dismissed')) items.push(dismissed);
        if (url.searchParams.has('showExcluded')) items.push(excluded);
        if (url.searchParams.has('showDuplicates')) items.push(duplicate);
        return { items, total: items.length, nextOffset: null };
      },
    });
    const user = userEvent.setup();
    renderApp('/jobs');
    await screen.findByText('Job 1');
    // The default request asks for no hidden group.
    expect(queries[0]!.get('status')).toBe('new,saved');
    expect(queries[0]!.has('showExcluded')).toBe(false);
    expect(queries[0]!.has('showDuplicates')).toBe(false);

    await user.click(screen.getByRole('button', { name: /Filters/ }));
    await user.click(screen.getByRole('checkbox', { name: 'Dismissed' }));
    await screen.findByText('Job 2');
    expect(within(cardOf('Job 2')).getByText('Dismissed')).toBeInTheDocument();
    expect(screen.queryByText('Job 3')).not.toBeInTheDocument();

    await user.click(screen.getByRole('checkbox', { name: 'Show excluded' }));
    await screen.findByText('Job 3');
    expect(within(cardOf('Job 3')).getByText('Excluded: excluded company')).toBeInTheDocument();
    expect(screen.queryByText('Job 4')).not.toBeInTheDocument();

    await user.click(screen.getByRole('checkbox', { name: 'Show duplicates' }));
    await screen.findByText('Job 4');
    expect(within(cardOf('Job 4')).getByText('Duplicate')).toBeInTheDocument();
    const last = queries[queries.length - 1]!;
    expect(last.get('status')?.split(',').sort()).toEqual(['dismissed', 'new', 'saved']);
    expect(last.has('showExcluded')).toBe(true);
    expect(last.has('showDuplicates')).toBe(true);
  });

  it('marks an unread posting as read when the user opens it', async () => {
    const items = [makeItem('1', 90), makeItem('2', 70, { unread: false })];
    const api = mockApi({
      ...baseRoutes(() => items),
      'GET /api/postings/1': () => detailOf(items[0]!),
      'PATCH /api/postings/1': () => ({ previous: [] }),
    });
    const user = userEvent.setup();
    renderApp('/jobs');
    await screen.findByText('Job 1');
    // Unread until the user opens it.
    expect(within(cardOf('Job 1')).getByText('Unread.')).toBeInTheDocument();
    expect(within(cardOf('Job 2')).queryByText('Unread.')).not.toBeInTheDocument();
    expect(api.calls.some((c) => c.method === 'PATCH')).toBe(false);

    await user.click(within(cardOf('Job 1')).getByRole('button', { name: /Job 1/ }));
    expect(await screen.findByRole('heading', { name: 'Job 1' })).toBeInTheDocument();
    await waitFor(() => expect(api.calls.find((c) => c.method === 'PATCH' && c.path === '/api/postings/1')?.body).toEqual({ read: true }));
    await waitFor(() => expect(within(cardOf('Job 1')).queryByText('Unread.')).not.toBeInTheDocument());
  });

  it('applies dismiss, applied, restore, and undo with their keys', async () => {
    const items = [makeItem('1', 90), makeItem('2', 70), makeItem('3', 60, { triageStatus: 'dismissed' })];
    const api = mockApi({
      ...baseRoutes(() => items),
      'POST /api/postings/bulk': (c) => ({
        previous: (c.body as { ids: string[] }).ids.map((id) => ({ id, triageStatus: items.find((i) => i.id === id)!.triageStatus })),
      }),
      'POST /api/postings/restore': () => ({ ok: true }),
    });
    const user = userEvent.setup();
    // Every status is in view, so each row stays after its action.
    renderApp('/jobs?status=all');
    await screen.findByText('Job 1');
    const bulk = () => api.calls.filter((c) => c.path === '/api/postings/bulk').map((c) => c.body);

    await user.keyboard('d');
    await waitFor(() => expect(bulk()).toEqual([{ ids: ['1'], action: 'dismiss' }]));
    await waitFor(() => expect(within(cardOf('Job 1')).getByText('Dismissed')).toBeInTheDocument());

    await user.keyboard('j');
    await user.keyboard('a');
    await waitFor(() => expect(bulk()).toHaveLength(2));
    expect(bulk()[1]).toEqual({ ids: ['2'], action: 'apply' });
    await waitFor(() => expect(within(cardOf('Job 2')).getByText('Applied')).toBeInTheDocument());

    await user.keyboard('j');
    await user.keyboard('r');
    await waitFor(() => expect(bulk()).toHaveLength(3));
    expect(bulk()[2]).toEqual({ ids: ['3'], action: 'restore' });
    await screen.findByText(/Restored “Job 3”/);

    // Undo reverts the last action.
    await user.keyboard('u');
    await waitFor(() =>
      expect(api.calls.filter((c) => c.path === '/api/postings/restore').map((c) => c.body)).toEqual([{ previous: [{ id: '3', triageStatus: 'dismissed' }] }]),
    );
  });

  it('lists the keys for moving through the list and for each triage action', async () => {
    mockApi(baseRoutes(() => [makeItem('1', 90)]));
    const user = userEvent.setup();
    renderApp('/jobs');
    await screen.findByText('Job 1');
    await user.click(screen.getByRole('button', { name: /Shortcuts/ }));
    const dialog = within(await screen.findByRole('dialog', { name: 'Keyboard shortcuts' }));
    const keyOf = (label: string) => dialog.getByText(label).previousElementSibling?.textContent;
    expect(keyOf('Next posting')).toBe('j');
    expect(keyOf('Previous posting')).toBe('k');
    expect(keyOf('Move between cards in the grid')).toBe('Arrow keys');
    expect(keyOf('Save')).toBe('s');
    expect(keyOf('Dismiss')).toBe('d');
    expect(keyOf('Mark as applied')).toBe('a');
    expect(keyOf('Restore to new')).toBe('r');
    expect(keyOf('Undo the last action')).toBe('u');
  });

  it('shows an arriving score in the row, moves the row to its rank, and keeps the cursor on its posting', async () => {
    FakeEventSource.instances = [];
    vi.stubGlobal('EventSource', FakeEventSource);
    const items = [makeItem('1', 90), makeItem('2', 60), makeItem('3', null)];
    const api = mockApi({
      ...baseRoutes(() => items),
      'GET /api/postings/3': () =>
        detailOf(items[2]!, {
          match: {
            state: 'scored',
            totalScore: 80,
            stale: false,
            excludedReason: null,
            failReason: null,
            skillsScore: 80,
            experienceScore: 80,
            preferenceScore: 80,
            locationScore: 80,
            matchedSkills: [],
            missingSkills: [],
            assessment: 'ok',
            softViolations: [],
            provider: null,
            model: null,
          },
        }),
    });
    const user = userEvent.setup();
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    render(<App queryClient={queryClient} history={createMemoryHistory({ initialEntries: ['/jobs'] })} />);
    await screen.findByText('Job 1');
    await user.keyboard('j');
    expect(cardOf('Job 2')).toHaveAttribute('aria-current', 'true');
    expect(cardOf('Job 3')).toHaveAttribute('data-index', '2');
    expect(within(cardOf('Job 3')).getByText('Waiting')).toBeInTheDocument();
    const slot = cardOf('Job 3').parentElement as HTMLElement;
    const grid = slot.parentElement as HTMLElement;
    const before = slot.style.transform;

    act(() => FakeEventSource.instances[0]!.send({ type: 'match.updated', postingId: '3' }));

    // The row shows the score, and the page did not load the list again.
    await waitFor(() => expect(within(cardOf('Job 3')).getByText('80')).toBeInTheDocument());
    expect(api.calls.filter((c) => c.path === '/api/postings')).toHaveLength(1);
    // The row moves to its rank. The same element gets a new position, and the grid animates a change of position.
    await waitFor(() => expect(cardOf('Job 3')).toHaveAttribute('data-index', '1'));
    expect(cardOf('Job 2')).toHaveAttribute('data-index', '2');
    expect(cardOf('Job 3').parentElement).toBe(slot);
    expect(slot.style.transform).not.toBe(before);
    expect(grid).toHaveClass('card-grid');
    expect(grid).not.toHaveAttribute('data-still');
    // The keyboard cursor stays on its posting.
    expect(cardOf('Job 2')).toHaveAttribute('aria-current', 'true');
    expect(cardOf('Job 3')).not.toHaveAttribute('aria-current');
  });
});

/**
 * A finger swipe on the card of this title: down, a first move that locks the axis, a move to `dx`, and up.
 * The browser sends a click after the finger lifts, so the helper does too. In tests every element is 800px
 * wide, so the threshold is 140px. The steps follow each other at once, so a swipe below 40px never counts as a fling.
 */
function swipeCard(title: string, dx: number, { pointerType = 'touch', dy = 0 }: { pointerType?: string; dy?: number } = {}) {
  const target = cardOf(title).querySelector('button[data-row-button]') as HTMLElement;
  const at = (x: number, y: number) => ({ pointerId: 1, pointerType, clientX: x, clientY: y });
  fireEvent.pointerDown(target, at(300, 300));
  fireEvent.pointerMove(target, dy ? at(302, 300 + Math.sign(dy) * 20) : at(300 + Math.sign(dx) * 15, 300));
  fireEvent.pointerMove(target, at(300 + dx, 300 + dy));
  fireEvent.pointerUp(target, at(300 + dx, 300 + dy));
  // The click that a browser may send after the gesture comes from the pointer, so its detail is 1.
  fireEvent.click(target, { detail: 1 });
}

function swipeRoutes(items: () => PostingListItem[], onTriage: (ids: string[], action: string) => void = () => {}) {
  return {
    ...baseRoutes(items),
    'POST /api/postings/bulk': (c: { body: unknown }) => {
      const { ids, action } = c.body as { ids: string[]; action: string };
      onTriage(ids, action);
      return { previous: ids.map((id) => ({ id, triageStatus: items().find((i) => i.id === id)?.triageStatus ?? 'new' })) };
    },
  };
}

const triageCalls = (api: ReturnType<typeof mockApi>) => api.calls.filter((c) => c.path === '/api/postings/bulk').map((c) => c.body);

async function undoToast(text: RegExp): Promise<HTMLElement> {
  const toast = (await screen.findByText(text)).closest('[role="status"]') as HTMLElement;
  expect(within(toast).getByRole('button', { name: 'Undo' })).toBeInTheDocument();
  return toast;
}

describe('swipe triage', () => {
  beforeEach(() => resetToastsForTests());
  afterEach(() => {
    vi.unstubAllGlobals();
    resetToastsForTests();
  });

  it('dismisses a new posting on a swipe to the left, removes its card, offers undo, and does not open it', async () => {
    let items = [makeItem('1', 90), makeItem('2', 70)];
    const api = mockApi(
      swipeRoutes(
        () => items,
        (ids) => (items = items.filter((i) => !ids.includes(i.id))),
      ),
    );
    const { history } = renderApp('/jobs');
    await screen.findByText('Job 1');

    swipeCard('Job 1', -200);
    await waitFor(() => expect(triageCalls(api)).toEqual([{ ids: ['1'], action: 'dismiss' }]));
    await waitFor(() => expect(screen.queryByText('Job 1')).not.toBeInTheDocument());
    await undoToast(/Dismissed “Job 1”/);
    expect(history.location.search).toBe('');
  });

  it('dismisses the open posting when the user leaves the page while its card slides out, and stays on the new page', async () => {
    let items = [makeItem('1', 90), makeItem('2', 70)];
    const api = mockApi({
      ...swipeRoutes(
        () => items,
        (ids) => (items = items.filter((i) => !ids.includes(i.id))),
      ),
      'GET /api/applications': () => [],
    });
    const { history } = renderApp('/jobs?id=1');
    await screen.findAllByText('Job 1');

    swipeCard('Job 1', -200);
    act(() => history.push('/board'));
    await waitFor(() => expect(triageCalls(api)).toEqual([{ ids: ['1'], action: 'dismiss' }]));
    await new Promise((r) => setTimeout(r, 300));
    expect(history.location.pathname).toBe('/board');
  });

  it('saves a new posting on a swipe to the right and keeps its card in the default list', async () => {
    let items = [makeItem('1', 90)];
    const api = mockApi(
      swipeRoutes(
        () => items,
        () => (items = [makeItem('1', 90, { triageStatus: 'saved' })]),
      ),
    );
    renderApp('/jobs');
    await screen.findByText('Job 1');

    swipeCard('Job 1', 200);
    await waitFor(() => expect(triageCalls(api)).toEqual([{ ids: ['1'], action: 'save' }]));
    await undoToast(/Saved “Job 1”/);
    await waitFor(() => expect(within(cardOf('Job 1')).getByText('Saved')).toBeInTheDocument());
  });

  it('marks a saved posting as applied on a swipe to the right', async () => {
    const items = [makeItem('1', 90, { triageStatus: 'saved' })];
    const api = mockApi(swipeRoutes(() => items));
    renderApp('/jobs');
    await screen.findByText('Job 1');

    swipeCard('Job 1', 200);
    await waitFor(() => expect(triageCalls(api)).toEqual([{ ids: ['1'], action: 'apply' }]));
    await undoToast(/Marked as applied “Job 1”/);
  });

  it('makes a saved posting new again on a swipe to the left, and the card stays', async () => {
    let items = [makeItem('1', 90, { triageStatus: 'saved' })];
    const api = mockApi(
      swipeRoutes(
        () => items,
        () => (items = [makeItem('1', 90)]),
      ),
    );
    renderApp('/jobs');
    await screen.findByText('Job 1');

    swipeCard('Job 1', -200);
    await waitFor(() => expect(triageCalls(api)).toEqual([{ ids: ['1'], action: 'restore' }]));
    await undoToast(/Restored “Job 1”/);
    expect(cardOf('Job 1')).toBeInTheDocument();
    await waitFor(() => expect(within(cardOf('Job 1')).queryByText('Saved')).not.toBeInTheDocument());
  });

  it('makes a dismissed posting new again on a swipe to the right', async () => {
    const items = [makeItem('1', 90, { triageStatus: 'dismissed' })];
    const api = mockApi(swipeRoutes(() => items));
    renderApp('/jobs?status=all');
    await screen.findByText('Job 1');

    swipeCard('Job 1', 200);
    await waitFor(() => expect(triageCalls(api)).toEqual([{ ids: ['1'], action: 'restore' }]));
    await undoToast(/Restored “Job 1”/);
  });

  it('changes nothing and opens nothing after a short swipe', async () => {
    const items = [makeItem('1', 90)];
    const api = mockApi(swipeRoutes(() => items));
    const { history } = renderApp('/jobs');
    await screen.findByText('Job 1');

    swipeCard('Job 1', -30);
    await new Promise((r) => setTimeout(r, 300));
    expect(triageCalls(api)).toEqual([]);
    expect(history.location.search).toBe('');
    expect(cardOf('Job 1')).toBeInTheDocument();
  });

  it('ignores a sideways mouse drag', async () => {
    const items = [makeItem('1', 90)];
    const api = mockApi(swipeRoutes(() => items));
    renderApp('/jobs');
    await screen.findByText('Job 1');

    swipeCard('Job 1', -200, { pointerType: 'mouse' });
    await new Promise((r) => setTimeout(r, 300));
    expect(triageCalls(api)).toEqual([]);
    expect(within(cardOf('Job 1')).queryByText('Dismiss')).not.toBeInTheDocument();
  });

  it('changes no status on a mostly vertical drag', async () => {
    const items = [makeItem('1', 90)];
    const api = mockApi(swipeRoutes(() => items));
    renderApp('/jobs');
    await screen.findByText('Job 1');

    swipeCard('Job 1', -20, { dy: -250 });
    await new Promise((r) => setTimeout(r, 300));
    expect(triageCalls(api)).toEqual([]);
    expect(cardOf('Job 1')).toBeInTheDocument();
  });

  it('acts on the swiped card only and keeps the other cards selected', async () => {
    let items = [makeItem('1', 90), makeItem('2', 70), makeItem('3', 40)];
    const api = mockApi(
      swipeRoutes(
        () => items,
        (ids) => (items = items.filter((i) => !ids.includes(i.id))),
      ),
    );
    const user = userEvent.setup();
    renderApp('/jobs');
    await screen.findByText('Job 1');
    await user.click(screen.getByRole('checkbox', { name: 'Select Job 2' }));
    await user.click(screen.getByRole('checkbox', { name: 'Select Job 3' }));

    swipeCard('Job 1', -200);
    await waitFor(() => expect(triageCalls(api)).toEqual([{ ids: ['1'], action: 'dismiss' }]));
    await waitFor(() => expect(screen.queryByText('Job 1')).not.toBeInTheDocument());
    expect(screen.getByRole('checkbox', { name: 'Select Job 2' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Select Job 3' })).toBeChecked();
  });

  describe('an applied posting swiped to the left', () => {
    function applied() {
      const items = [makeItem('1', 90, { triageStatus: 'applied' })];
      return mockApi({
        ...swipeRoutes(() => items),
        'DELETE /api/applications/1': () => ({ ok: true }),
      });
    }
    const deletes = (api: ReturnType<typeof mockApi>) => api.calls.filter((c) => c.method === 'DELETE');

    it('returns the card and asks before it removes the application', async () => {
      const api = applied();
      renderApp('/jobs?status=all');
      await screen.findByText('Job 1');

      swipeCard('Job 1', -200);
      const dialog = await screen.findByRole('dialog', { name: 'Remove the application?' });
      expect(dialog).toHaveTextContent(
        '“Job 1” at Company 1 goes back to saved. Its notes, stage history and interview date are deleted, and this can’t be undone.',
      );
      expect(within(dialog).getByRole('button', { name: 'Cancel' })).toHaveFocus();
      const card = cardOf('Job 1').querySelector('[style]') as HTMLElement;
      expect(card.style.transform).toBe('');
      expect(deletes(api)).toEqual([]);
      expect(triageCalls(api)).toEqual([]);
    });

    it('removes the application after the confirmation, with no undo', async () => {
      const api = applied();
      const user = userEvent.setup();
      renderApp('/jobs?status=all');
      await screen.findByText('Job 1');

      swipeCard('Job 1', -200);
      const dialog = await screen.findByRole('dialog', { name: 'Remove the application?' });
      await user.click(within(dialog).getByRole('button', { name: 'Remove application' }));
      await waitFor(() => expect(deletes(api).map((c) => c.path)).toEqual(['/api/applications/1']));
      const toast = (await screen.findByText('Application removed. The posting is saved in the job list.')).closest('[role="status"]') as HTMLElement;
      expect(within(toast).queryByRole('button', { name: 'Undo' })).not.toBeInTheDocument();
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    });

    it('keeps the application when the user cancels', async () => {
      const api = applied();
      const user = userEvent.setup();
      renderApp('/jobs?status=all');
      await screen.findByText('Job 1');

      swipeCard('Job 1', -200);
      const dialog = await screen.findByRole('dialog', { name: 'Remove the application?' });
      await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
      expect(deletes(api)).toEqual([]);
      expect(within(cardOf('Job 1')).getByText('Applied')).toBeInTheDocument();
    });
  });
});

const TRIAGE_STATUS: Record<string, PostingListItem['triageStatus']> = { save: 'saved', dismiss: 'dismissed', restore: 'new', apply: 'applied' };

/**
 * A server that keeps the status of each posting. The list shows the new and saved postings, as the default list does.
 * Triage and undo change the stored status, and each detail returns it.
 */
function postingServer(initial: PostingListItem[], extra: Record<string, Parameters<typeof mockApi>[0][string]> = {}) {
  const all = new Map(initial.map((i) => [i.id, i]));
  const visible = () => [...all.values()].filter((i) => i.triageStatus === 'new' || i.triageStatus === 'saved');
  const routes: Parameters<typeof mockApi>[0] = {
    ...baseRoutes(visible),
    'POST /api/postings/bulk': (c) => {
      const { ids, action } = c.body as { ids: string[]; action: string };
      const status = TRIAGE_STATUS[action];
      if (!status) return { previous: [], queued: ids.length };
      const previous = ids.map((id) => ({ id, triageStatus: all.get(id)!.triageStatus }));
      for (const id of ids) all.set(id, { ...all.get(id)!, triageStatus: status });
      return { previous };
    },
    'POST /api/postings/restore': (c) => {
      for (const p of (c.body as { previous: Array<{ id: string; triageStatus: PostingListItem['triageStatus'] }> }).previous) {
        all.set(p.id, { ...all.get(p.id)!, triageStatus: p.triageStatus });
      }
      return { ok: true };
    },
  };
  for (const item of initial) {
    routes[`GET /api/postings/${item.id}`] = () => detailOf(all.get(item.id)!);
    routes[`PATCH /api/postings/${item.id}`] = (c) => {
      all.set(item.id, { ...all.get(item.id)!, unread: !(c.body as { read: boolean }).read });
      return { previous: [] };
    };
  }
  const api = mockApi({ ...routes, ...extra });
  return { all, api };
}

const detailView = () => within(screen.getByRole('complementary', { name: 'Posting details' }));
const markReadCalls = (api: ReturnType<typeof mockApi>, id: string) => api.calls.filter((c) => c.method === 'PATCH' && c.path === `/api/postings/${id}`);
const restoreCalls = (api: ReturnType<typeof mockApi>) => api.calls.filter((c) => c.path === '/api/postings/restore');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const bottomBar = () => document.documentElement.style.getPropertyValue('--bottom-bar');
/** The button of a card, which opens its posting. */
const cardButton = (title: string) => cardOf(title).querySelector<HTMLElement>('button[data-row-button]')!;

/** Closes the undo message of this text with its close button. */
async function closeToast(user: ReturnType<typeof userEvent.setup>, text: RegExp) {
  const toast = (await screen.findByText(text)).closest('[role="status"]') as HTMLElement;
  await user.click(within(toast).getByRole('button', { name: 'Close message' }));
  await waitFor(() => expect(screen.queryByText(text, { selector: '[role="status"] *' })).not.toBeInTheDocument());
}

describe('undo after the message', () => {
  beforeEach(() => resetToastsForTests());
  afterEach(() => {
    vi.unstubAllGlobals();
    resetToastsForTests();
  });

  it('shows an undo control in the job list that names the triage action once its message closes', async () => {
    postingServer([makeItem('1', 90), makeItem('2', 70)]);
    const user = userEvent.setup();
    renderApp('/jobs');
    await screen.findByText('Job 1');

    await user.keyboard('d');
    await screen.findByText(/Dismissed “Job 1”/);
    // While the message shows, the message has the undo.
    expect(screen.queryByRole('button', { name: /^Undo · / })).not.toBeInTheDocument();

    await closeToast(user, /Dismissed “Job 1”/);
    const control = await screen.findByRole('button', { name: 'Undo · Dismissed “Job 1”.' });
    // The control stands in the top row of the job list, beside the selection.
    const selectAll = screen.getByRole('checkbox', { name: /Select all loaded/ });
    expect(control.closest('div')?.parentElement).toContainElement(selectAll);
    // At 375px the control shortens with an ellipsis. "Select all loaded" keeps its line instead of wrapping in the 44px row.
    expect(selectAll.closest('label')).toHaveClass('shrink-0', 'whitespace-nowrap');
    expect(control).toHaveClass('min-w-0', 'shrink');
  });

  it('keeps the triage undo, its control and the u key when a stage move on the board came after it', async () => {
    const { api } = postingServer([makeItem('1', 90), makeItem('2', 70)]);
    const user = userEvent.setup();
    renderApp('/jobs');
    await screen.findByText('Job 1');
    await user.keyboard('d');
    await closeToast(user, /Dismissed “Job 1”/);
    await screen.findByRole('button', { name: 'Undo · Dismissed “Job 1”.' });

    // A stage move on the board, as `useMoveApplication` reports it.
    const stageUndo = vi.fn(async () => {});
    act(() => void showUndoToast({ kind: 'stage', message: 'Moved to Interview.', undo: stageUndo }));
    await closeToast(user, /Moved to Interview/);
    expect(screen.getByRole('button', { name: 'Undo · Dismissed “Job 1”.' })).toBeInTheDocument();

    await user.keyboard('u');
    await waitFor(() => expect(restoreCalls(api).map((c) => c.body)).toEqual([{ previous: [{ id: '1', triageStatus: 'new' }] }]));
    expect(stageUndo).not.toHaveBeenCalled();
    // Nothing of the job list is left to undo. The stage move stays for the board.
    await user.keyboard('u');
    expect(await screen.findByText('Nothing to undo.')).toBeInTheDocument();
    expect(stageUndo).not.toHaveBeenCalled();
  });

  it('undoes the triage action from the undo control after the message has closed', async () => {
    const { api } = postingServer([makeItem('1', 90), makeItem('2', 70)]);
    const user = userEvent.setup();
    renderApp('/jobs');
    await screen.findByText('Job 1');
    await user.keyboard('d');
    await closeToast(user, /Dismissed “Job 1”/);

    await user.click(await screen.findByRole('button', { name: 'Undo · Dismissed “Job 1”.' }));
    await waitFor(() => expect(restoreCalls(api).map((c) => c.body)).toEqual([{ previous: [{ id: '1', triageStatus: 'new' }] }]));
    expect(await screen.findByText('Job 1')).toBeInTheDocument();
    // The undo ran, so nothing is left to undo.
    expect(screen.queryByRole('button', { name: /^Undo · / })).not.toBeInTheDocument();
  });

  it('shows the dismissed posting again in the detail view, with its earlier status, when the user undoes the dismissal', async () => {
    const { api } = postingServer([makeItem('1', 90), makeItem('2', 70), makeItem('3', 60)]);
    const user = userEvent.setup();
    const { history } = renderApp('/jobs?id=1');
    await screen.findByRole('heading', { name: 'Job 1' });

    await user.click(detailView().getByRole('button', { name: 'Dismiss' }));
    // The detail view moves on to the next posting.
    expect(await screen.findByRole('heading', { name: 'Job 2' })).toBeInTheDocument();
    expect(history.location.search).toBe('?id=2');

    const toast = (await screen.findByText(/Dismissed “Job 1”/)).closest('[role="status"]') as HTMLElement;
    await user.click(within(toast).getByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(restoreCalls(api)).toHaveLength(1));
    expect(await screen.findByRole('heading', { name: 'Job 1' })).toBeInTheDocument();
    expect(history.location.search).toBe('?id=1');
    await waitFor(() => expect(detailView().getByText('New')).toBeInTheDocument());
    expect(detailView().getByRole('button', { name: 'Dismiss' })).toBeInTheDocument();
  });

  it('stays on the next posting when the undo request fails', async () => {
    const { api } = postingServer([makeItem('1', 90), makeItem('2', 70)], {
      'POST /api/postings/restore': () => new Response(JSON.stringify({ error: 'Database is locked.' }), { status: 500 }),
    });
    const user = userEvent.setup();
    const { history } = renderApp('/jobs?id=1');
    await screen.findByRole('heading', { name: 'Job 1' });
    await user.click(detailView().getByRole('button', { name: 'Dismiss' }));
    await screen.findByRole('heading', { name: 'Job 2' });

    await user.keyboard('u');
    await waitFor(() => expect(restoreCalls(api)).toHaveLength(1));
    expect(await screen.findByText(/Undo failed/)).toBeInTheDocument();
    expect(history.location.search).toBe('?id=2');
    expect(screen.getByRole('heading', { name: 'Job 2' })).toBeInTheDocument();
  });

  it('does not open the job list again when the user undoes from another page', async () => {
    const { api } = postingServer([makeItem('1', 90), makeItem('2', 70)], { 'GET /api/applications': () => [] });
    const user = userEvent.setup();
    const { history } = renderApp('/jobs?id=1');
    await screen.findByRole('heading', { name: 'Job 1' });
    await user.click(detailView().getByRole('button', { name: 'Dismiss' }));
    await screen.findByRole('heading', { name: 'Job 2' });

    act(() => history.push('/board'));
    const toast = (await screen.findByText(/Dismissed “Job 1”/)).closest('[role="status"]') as HTMLElement;
    await user.click(within(toast).getByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(restoreCalls(api)).toHaveLength(1));
    await sleep(50);
    expect(history.location.pathname).toBe('/board');
  });
});

describe('detail action bar', () => {
  beforeEach(() => resetToastsForTests());
  afterEach(() => {
    vi.unstubAllGlobals();
    resetToastsForTests();
  });

  it.each([
    ['new', ['Save', 'Dismiss', 'Mark as applied']],
    ['saved', ['Dismiss', 'Mark as applied']],
    ['dismissed', ['Save', 'Restore', 'Mark as applied']],
    ['applied', ['Dismiss', 'Open on board']],
  ] as const)('holds the triage buttons of a %s posting in the bar at the bottom on a phone', async (status, labels) => {
    mockMedia({ coarse: true, width: 430 });
    postingServer([makeItem('1', 90, { triageStatus: status })]);
    renderApp('/jobs?id=1');
    await screen.findByRole('heading', { name: 'Job 1' });

    const bar = await screen.findByRole('group', { name: 'Triage actions' });
    const controls = [...bar.querySelectorAll('button, a')];
    expect(controls.map((b) => b.textContent)).toEqual(labels);
    for (const control of controls) expect(control).toHaveClass('h-11', 'flex-1');
    // The bar is below the scroller, and the header keeps only Rescore.
    const header = screen.getByRole('heading', { name: 'Job 1' }).closest('header') as HTMLElement;
    for (const label of labels) expect(within(header).queryByRole('button', { name: label })).not.toBeInTheDocument();
    expect(within(header).getByRole('button', { name: 'Rescore' })).toBeInTheDocument();
    // The toasts stand above the bar.
    expect(bottomBar()).toBe('600px');
  });

  it('dismisses from the bar and moves on to the next posting', async () => {
    mockMedia({ coarse: true, width: 430 });
    const { api } = postingServer([makeItem('1', 90), makeItem('2', 70)]);
    const user = userEvent.setup();
    const { history } = renderApp('/jobs?id=1');
    await screen.findByRole('heading', { name: 'Job 1' });
    await user.click(within(await screen.findByRole('group', { name: 'Triage actions' })).getByRole('button', { name: 'Dismiss' }));
    await waitFor(() => expect(triageCalls(api)).toEqual([{ ids: ['1'], action: 'dismiss' }]));
    expect(await screen.findByRole('heading', { name: 'Job 2' })).toBeInTheDocument();
    expect(history.location.search).toBe('?id=2');
  });

  it('keeps the triage buttons in the detail header at 1440px', async () => {
    mockMedia({ width: 1440 });
    postingServer([makeItem('1', 90)]);
    renderApp('/jobs?id=1');
    const heading = await screen.findByRole('heading', { name: 'Job 1' });
    const header = heading.closest('header') as HTMLElement;
    for (const label of ['Save', 'Dismiss', 'Mark as applied', 'Rescore']) expect(within(header).getByRole('button', { name: label })).toHaveClass('h-7');
    expect(screen.queryByRole('group', { name: 'Triage actions' })).not.toBeInTheDocument();
    expect(bottomBar()).toBe('');
  });

  it('lets the toasts go back down when the detail view closes', async () => {
    mockMedia({ coarse: true, width: 430 });
    postingServer([makeItem('1', 90)]);
    const user = userEvent.setup();
    renderApp('/jobs?id=1');
    await screen.findByRole('group', { name: 'Triage actions' });
    expect(bottomBar()).toBe('600px');
    await user.click(screen.getByRole('button', { name: 'Close details' }));
    await waitFor(() => expect(screen.queryByRole('complementary')).not.toBeInTheDocument());
    expect(bottomBar()).toBe('');
  });
});

describe('bulk actions', () => {
  beforeEach(() => resetToastsForTests());
  afterEach(() => {
    vi.unstubAllGlobals();
    resetToastsForTests();
  });

  const selectAll = () => screen.getByRole('checkbox', { name: /Select all loaded|selected/ });

  it('shows a mixed state on the select-all control when part of the list is selected', async () => {
    postingServer([makeItem('1', 90), makeItem('2', 70), makeItem('3', 60)]);
    const user = userEvent.setup();
    renderApp('/jobs');
    await screen.findByText('Job 1');
    expect(selectAll()).not.toBePartiallyChecked();

    await user.click(screen.getByRole('checkbox', { name: 'Select Job 2' }));
    expect(selectAll()).toBePartiallyChecked();
    expect(selectAll()).not.toBeChecked();

    // With every posting selected, the control is checked and no longer mixed.
    await user.click(screen.getByRole('checkbox', { name: 'Select Job 1' }));
    await user.click(screen.getByRole('checkbox', { name: 'Select Job 3' }));
    expect(selectAll()).toBeChecked();
    expect(selectAll()).not.toBePartiallyChecked();
  });

  it('clears a partial selection when the user uses the select-all control', async () => {
    postingServer([makeItem('1', 90), makeItem('2', 70), makeItem('3', 60)]);
    const user = userEvent.setup();
    renderApp('/jobs');
    await screen.findByText('Job 1');
    await user.click(screen.getByRole('checkbox', { name: 'Select Job 1' }));
    await user.click(screen.getByRole('checkbox', { name: 'Select Job 2' }));
    expect(screen.getByText('2 selected')).toBeInTheDocument();

    await user.click(selectAll());
    expect(screen.queryByText(/selected$/)).not.toBeInTheDocument();
    for (const n of [1, 2, 3]) expect(screen.getByRole('checkbox', { name: `Select Job ${n}` })).not.toBeChecked();
    expect(selectAll()).not.toBeChecked();
    expect(selectAll()).not.toBePartiallyChecked();

    // From nothing selected, the control selects every loaded posting.
    await user.click(selectAll());
    expect(screen.getByText('3 selected')).toBeInTheDocument();
  });

  it('puts the bulk actions in a bar at the bottom of the list on a phone, with Clear beside the count', async () => {
    mockMedia({ coarse: true, width: 430 });
    const { api } = postingServer([makeItem('1', 90), makeItem('2', 70), makeItem('3', 60)]);
    const user = userEvent.setup();
    renderApp('/jobs');
    await screen.findByText('Job 1');
    expect(screen.queryByRole('toolbar', { name: 'Bulk actions' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('checkbox', { name: 'Select Job 1' }));
    await user.click(screen.getByRole('checkbox', { name: 'Select Job 2' }));

    const bar = screen.getByRole('toolbar', { name: 'Bulk actions' });
    expect(
      within(bar)
        .getAllByRole('button')
        .map((b) => b.textContent),
    ).toEqual(['Save', 'Dismiss', 'Applied']);
    for (const b of within(bar).getAllByRole('button')) expect(b).toHaveClass('h-11');
    const more = within(bar).getByRole('combobox', { name: 'More bulk actions' });
    expect(more).toHaveDisplayValue('More');
    // Chrome draws the menu arrow inside the content box. With the 28px right padding of a select, "More" was cut at 375px.
    expect(more).toHaveClass('px-2');
    expect(more).not.toHaveClass('pr-7');
    // The card's selection box takes a 44px corner on a touch screen.
    expect(screen.getByRole('checkbox', { name: 'Select Job 1' }).closest('label')).toHaveClass('size-10', 'touch:size-11');
    expect(
      within(more)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['More', 'Restore', 'Rescore', 'Analyze', 'Mark read', 'Mark unread']);
    // The bar comes after the list, and the toasts stand above it.
    expect(screen.getByRole('list', { name: /Job postings/ }).compareDocumentPosition(bar) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(bottomBar()).toBe('600px');

    // Clear stands beside the count in the top row.
    const count = screen.getByText('2 selected');
    const clear = screen.getByRole('button', { name: 'Clear' });
    expect(count.closest('label')?.nextElementSibling).toBe(clear);

    await user.click(within(bar).getByRole('button', { name: 'Dismiss' }));
    await waitFor(() => expect(triageCalls(api)).toEqual([{ ids: ['1', '2'], action: 'dismiss' }]));
    await waitFor(() => expect(screen.queryByRole('toolbar', { name: 'Bulk actions' })).not.toBeInTheDocument());
    expect(bottomBar()).toBe('');
  });

  it.each([
    ['Restore', 'restore'],
    ['Rescore', 'rescore'],
    ['Analyze', 'analyze'],
    ['Mark read', 'read'],
    ['Mark unread', 'unread'],
  ])('runs "%s" from the More menu at a narrow width and shows the menu label again', async (label, action) => {
    mockMedia({ coarse: true, width: 430 });
    const { api } = postingServer([makeItem('1', 90), makeItem('2', 70)]);
    const user = userEvent.setup();
    renderApp('/jobs');
    await screen.findByText('Job 1');
    await user.click(screen.getByRole('checkbox', { name: 'Select Job 1' }));
    await user.click(screen.getByRole('checkbox', { name: 'Select Job 2' }));

    const more = screen.getByRole('combobox', { name: 'More bulk actions' });
    await user.selectOptions(more, label);
    await waitFor(() => expect(triageCalls(api)).toEqual([{ ids: ['1', '2'], action }]));
    // Restore keeps the selection only until it runs; the menu shows its label again either way.
    if (screen.queryByRole('combobox', { name: 'More bulk actions' }))
      expect(screen.getByRole('combobox', { name: 'More bulk actions' })).toHaveDisplayValue('More');
  });

  it('keeps every bulk action in the top row at 1440px', async () => {
    mockMedia({ width: 1440 });
    postingServer([makeItem('1', 90), makeItem('2', 70)]);
    const user = userEvent.setup();
    renderApp('/jobs');
    await screen.findByText('Job 1');
    await user.click(screen.getByRole('checkbox', { name: 'Select Job 1' }));
    const toolbar = screen.getByRole('toolbar', { name: 'Bulk actions' });
    expect(
      within(toolbar)
        .getAllByRole('button')
        .map((b) => b.textContent),
    ).toEqual(['Save', 'Dismiss', 'Restore', 'Applied', 'Rescore', 'Analyze', 'Mark read', 'Mark unread', 'Clear']);
    expect(screen.queryByRole('combobox', { name: 'More bulk actions' })).not.toBeInTheDocument();
    expect(bottomBar()).toBe('');
  });
});

describe('unread tracking of an auto-opened posting', () => {
  beforeEach(() => resetToastsForTests());
  afterEach(() => {
    vi.unstubAllGlobals();
    resetToastsForTests();
  });

  async function dismissFirst() {
    const server = postingServer([makeItem('1', 90), makeItem('2', 70), makeItem('3', 60)]);
    const user = userEvent.setup();
    const utils = renderApp('/jobs?id=1');
    await screen.findByRole('heading', { name: 'Job 1' });
    await waitFor(() => expect(markReadCalls(server.api, '1')).toHaveLength(1));
    await user.click(detailView().getByRole('button', { name: 'Dismiss' }));
    await screen.findByRole('heading', { name: 'Job 2' });
    return { ...server, ...utils, user };
  }

  it('keeps the next posting unread for 1.5 seconds after a triage opens it, then marks it read', async () => {
    const { api } = await dismissFirst();
    expect(markReadCalls(api, '2')).toHaveLength(0);
    await sleep(1000);
    expect(markReadCalls(api, '2')).toHaveLength(0);
    expect(within(cardOf('Job 2')).getByText('Unread.')).toBeInTheDocument();

    await waitFor(() => expect(markReadCalls(api, '2').map((c) => c.body)).toEqual([{ read: true }]), { timeout: 1500 });
    await waitFor(() => expect(within(cardOf('Job 2')).queryByText('Unread.')).not.toBeInTheDocument());
  });

  it('leaves the next posting unread when the user closes it within 1.5 seconds', async () => {
    const { api, user } = await dismissFirst();
    await user.click(screen.getByRole('button', { name: 'Close details' }));
    await sleep(1800);
    expect(markReadCalls(api, '2')).toHaveLength(0);
  });

  it('leaves the next posting unread when the user moves to another posting within 1.5 seconds', async () => {
    const { api, user, history } = await dismissFirst();
    await user.keyboard('j');
    await waitFor(() => expect(history.location.search).toBe('?id=3'));
    // A posting the user opens marks read at once.
    await waitFor(() => expect(markReadCalls(api, '3')).toHaveLength(1));
    await sleep(1800);
    expect(markReadCalls(api, '2')).toHaveLength(0);
  });
});

describe('focus and the keyboard cursor', () => {
  beforeEach(() => resetToastsForTests());
  afterEach(() => {
    vi.unstubAllGlobals();
    resetToastsForTests();
  });

  it('moves focus to the card of the posting when the user closes the detail view', async () => {
    mockMedia({ width: 1440 });
    postingServer([makeItem('1', 90), makeItem('2', 70), makeItem('3', 60)]);
    const user = userEvent.setup();
    renderApp('/jobs');
    await screen.findByText('Job 2');
    await user.click(cardButton('Job 2'));
    const heading = await screen.findByRole('heading', { name: 'Job 2' });
    await user.click(heading);
    expect(detailView().getByRole('heading', { name: 'Job 2' })).toHaveFocus();

    await user.click(screen.getByRole('button', { name: 'Close details' }));
    await waitFor(() => expect(cardButton('Job 2')).toHaveFocus());
    expect(cardButton('Job 2')).toHaveAttribute('id', 'row-2');
  });

  it('moves focus to the card of the posting when the user closes the full-screen detail on a phone', async () => {
    mockMedia({ coarse: true, width: 430 });
    postingServer([makeItem('1', 90), makeItem('2', 70)]);
    const user = userEvent.setup();
    renderApp('/jobs?id=2');
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Job 2' })).toHaveFocus());
    await user.click(screen.getByRole('button', { name: 'Close details' }));
    await waitFor(() => expect(cardButton('Job 2')).toHaveFocus());
  });

  it('moves focus to the card on a phone also when the page renders before the close commits, while the list is still inert', async () => {
    const media = mockMedia({ coarse: true, width: 430 });
    // jsdom ignores `inert`. A browser does not focus an element inside an inert subtree, so this focus does not either.
    const focus = HTMLElement.prototype.focus;
    const spy = vi.spyOn(HTMLElement.prototype, 'focus').mockImplementation(function (this: HTMLElement, options?: FocusOptions) {
      if (!this.closest('[inert]')) focus.call(this, options);
    });
    try {
      postingServer([makeItem('1', 90), makeItem('2', 70)]);
      renderApp('/jobs?id=2');
      await waitFor(() => expect(screen.getByRole('heading', { name: 'Job 2' })).toHaveFocus());
      // Any render between the close and the commit of the navigation, here from a rotation, still finds the list inert.
      act(() => {
        fireEvent.click(screen.getByRole('button', { name: 'Close details' }));
        media.set({ width: 700 });
      });
      await waitFor(() => expect(cardButton('Job 2')).toHaveFocus());
    } finally {
      spy.mockRestore();
    }
  });

  it('focuses the detail heading when the posting arrives on a phone, and makes the list behind it inert', async () => {
    mockMedia({ coarse: true, width: 430 });
    let release: () => void = () => {};
    const arrived = new Promise<void>((r) => (release = r));
    const items = [makeItem('1', 90), makeItem('2', 70)];
    postingServer(items, {
      'GET /api/postings/2': async () => {
        await arrived;
        return detailOf(items[1]!);
      },
    });
    const user = userEvent.setup();
    renderApp('/jobs');
    await screen.findByText('Job 2');
    const list = screen.getByRole('list', { name: /Job postings/ });
    expect(list.closest('[inert]')).toBeNull();

    await user.click(cardButton('Job 2'));
    await screen.findByRole('complementary', { name: 'Posting details' });
    expect(list.closest('[inert]')).not.toBeNull();
    expect(screen.queryByRole('heading', { name: 'Job 2', level: 2 })).not.toBeInTheDocument();

    release();
    const heading = await screen.findByRole('heading', { name: 'Job 2', level: 2 });
    await waitFor(() => expect(heading).toHaveFocus());
  });

  it('leaves focus in the list beside the detail at 1440px when a posting opens', async () => {
    mockMedia({ width: 1440 });
    postingServer([makeItem('1', 90), makeItem('2', 70)]);
    const user = userEvent.setup();
    renderApp('/jobs');
    await screen.findByText('Job 2');
    await user.click(cardButton('Job 2'));
    await screen.findByRole('heading', { name: 'Job 2', level: 2 });
    expect(cardButton('Job 2')).toHaveFocus();
    expect(screen.getByRole('list', { name: /Job postings/ }).closest('[inert]')).toBeNull();
  });

  it('keeps the cursor on the open posting when Tab moves focus to another card, and moves it with the cursor keys', async () => {
    mockMedia({ width: 1440 });
    const { api } = postingServer([makeItem('1', 90), makeItem('2', 70), makeItem('3', 60)]);
    const user = userEvent.setup();
    const { history } = renderApp('/jobs?id=1');
    await screen.findByRole('heading', { name: 'Job 1', level: 2 });
    expect(cardOf('Job 1')).toHaveAttribute('aria-current', 'true');

    act(() => cardButton('Job 3').focus());
    expect(cardOf('Job 1')).toHaveAttribute('aria-current', 'true');
    expect(cardOf('Job 3')).not.toHaveAttribute('aria-current');
    // A triage key still acts on the open posting.
    await user.keyboard('s');
    await waitFor(() => expect(triageCalls(api)).toEqual([{ ids: ['1'], action: 'save' }]));

    await user.keyboard('j');
    expect(cardOf('Job 2')).toHaveAttribute('aria-current', 'true');
    await waitFor(() => expect(history.location.search).toBe('?id=2'));
  });

  it('moves the cursor with a focus from Tab while no posting is open', async () => {
    postingServer([makeItem('1', 90), makeItem('2', 70)]);
    renderApp('/jobs');
    await screen.findByText('Job 2');
    act(() => cardButton('Job 2').focus());
    expect(cardOf('Job 2')).toHaveAttribute('aria-current', 'true');
  });

  it('offers a skip link from the list into the open posting', async () => {
    mockMedia({ width: 1440 });
    postingServer([makeItem('1', 90)]);
    const user = userEvent.setup();
    renderApp('/jobs');
    await screen.findByText('Job 1');
    expect(screen.queryByRole('link', { name: 'Go to the open posting' })).not.toBeInTheDocument();
    await user.click(cardButton('Job 1'));
    const heading = await screen.findByRole('heading', { name: 'Job 1', level: 2 });

    const skip = screen.getByRole('link', { name: 'Go to the open posting' });
    expect(skip).toHaveClass('sr-only', 'focus:not-sr-only');
    // It stands first in the list column, before the search.
    expect(skip.compareDocumentPosition(screen.getByRole('searchbox')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    await user.click(skip);
    expect(heading).toHaveFocus();
  });
});

describe('job list names and hints', () => {
  beforeEach(() => resetToastsForTests());
  afterEach(() => {
    vi.unstubAllGlobals();
    resetToastsForTests();
  });

  it('has a visually hidden "Jobs" heading and titles the page after the open posting', async () => {
    postingServer([makeItem('1', 90), makeItem('7', 82)]);
    const user = userEvent.setup();
    renderApp('/jobs');
    await screen.findByText('Job 7');
    expect(screen.getByRole('heading', { name: 'Jobs', level: 1 })).toHaveClass('sr-only');
    await waitFor(() => expect(document.title).toBe('Jobs · sieve'));

    await user.click(cardButton('Job 7'));
    await screen.findByRole('heading', { name: 'Job 7', level: 2 });
    await waitFor(() => expect(document.title).toBe('Job 7 · sieve'));

    await user.click(screen.getByRole('button', { name: 'Close details' }));
    await waitFor(() => expect(document.title).toBe('Jobs · sieve'));
  });

  it('names a card by its title first, then its company, score and band', async () => {
    postingServer([makeItem('1', 90), makeItem('2', null, { unread: false })]);
    renderApp('/jobs');
    await screen.findByText('Job 1');
    expect(cardButton('Job 1')).toHaveAccessibleName('Job 1 Company 1 · Copenhagen · Remote 90 Strong match Unread.');
    expect(cardButton('Job 2')).toHaveAccessibleName(/^Job 2 Company 2 · Copenhagen · Remote Waiting/);
    expect(cardButton('Job 1')).toHaveAccessibleDescription(/Jobindex/);
  });

  it('writes the foot of a card in 13px text', async () => {
    postingServer([makeItem('1', 90)]);
    renderApp('/jobs');
    await screen.findByText('Job 1');
    // The foot is the last part of the card's description.
    const foot = document.getElementById(cardButton('Job 1').getAttribute('aria-describedby')!.split(' ').at(-1)!)!;
    expect(foot).toHaveTextContent(/^Jobindex/);
    expect(foot).toHaveClass('text-[13px]');
    expect(foot).not.toHaveClass('text-xs');
  });

  it('hides the keyboard hints on a touch screen, and the ? key still opens the shortcut list', async () => {
    mockMedia({ coarse: true, width: 430 });
    postingServer([makeItem('1', 90)]);
    const user = userEvent.setup();
    renderApp('/jobs');
    await screen.findByText('Job 1');
    expect(screen.getByRole('button', { name: /Shortcuts/ })).toHaveClass('touch:hidden');
    expect(screen.getByRole('searchbox')).toHaveAttribute('placeholder', 'Search jobs');
    await user.keyboard('?');
    expect(await screen.findByRole('dialog', { name: 'Keyboard shortcuts' })).toBeInTheDocument();
  });

  it('shows the "/" hint in the search field with a mouse', async () => {
    mockMedia({ width: 1440 });
    postingServer([makeItem('1', 90)]);
    renderApp('/jobs');
    await screen.findByText('Job 1');
    expect(screen.getByRole('searchbox')).toHaveAttribute('placeholder', 'Search jobs   /');
  });

  it('returns focus to the Shortcuts button when the shortcut list closes', async () => {
    postingServer([makeItem('1', 90)]);
    const user = userEvent.setup();
    renderApp('/jobs');
    await screen.findByText('Job 1');
    const button = screen.getByRole('button', { name: /Shortcuts/ });
    await user.click(button);
    const dialog = await screen.findByRole('dialog', { name: 'Keyboard shortcuts' });
    // jsdom has no showModal, which moves focus into the dialog, so the test does.
    act(() => within(dialog).getByRole('button', { name: 'Close' }).focus());
    await user.click(within(dialog).getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(button).toHaveFocus();
  });

  it('closes the shortcut list on a tap on its backdrop and returns focus', async () => {
    postingServer([makeItem('1', 90)]);
    const user = userEvent.setup();
    renderApp('/jobs');
    await screen.findByText('Job 1');
    const button = screen.getByRole('button', { name: /Shortcuts/ });
    await user.click(button);
    const dialog = await screen.findByRole('dialog', { name: 'Keyboard shortcuts' });
    act(() => within(dialog).getByRole('button', { name: 'Close' }).focus());
    // A click inside the list keeps it open.
    await user.click(within(dialog).getByText('Next posting'));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    // The backdrop belongs to the dialog element itself.
    fireEvent.click(dialog);
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(button).toHaveFocus();
  });
});
