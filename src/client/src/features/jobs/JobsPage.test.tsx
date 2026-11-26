import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryHistory } from '@tanstack/react-router';
import { QueryClient } from '@tanstack/react-query';
import type { MatchSummary, PostingDetail, PostingListItem, ServerEvent } from '../../../../shared/api';
import { App } from '../../app/App';
import { STATUS, makeItem, mockApi, renderApp } from '../../test-utils';
import { resetToastsForTests } from '../../lib/toast';

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
  return { ...item, description: 'Build things.', facts: null, sourceLinks: [], application: null, match: null, coverLetter: null, matchAnalysis: null, ...extra };
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
    await waitFor(() =>
      expect(api.calls.find((c) => c.path === '/api/postings/restore')?.body).toEqual({ previous: [{ id: '1', triageStatus: 'saved' }] }),
    );
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
          state: 'scored', totalScore: 82, stale: false, excludedReason: null, failReason: null, skillsScore: 90, experienceScore: 80,
          preferenceScore: 70, locationScore: 60, matchedSkills: ['React'], missingSkills: ['Go'], assessment: 'Good fit.', softViolations: [],
          provider: 'local', model: 'm',
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
      'GET /api/postings/7': () => ({ ...item, description: 'Build things.', facts: null, sourceLinks: [], application: null, match: null, coverLetter: null, matchAnalysis: null }),
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
            state: 'scored', totalScore: 80, stale: false, excludedReason: null, failReason: null, skillsScore: 80, experienceScore: 80,
            preferenceScore: 80, locationScore: 80, matchedSkills: [], missingSkills: [], assessment: 'ok', softViolations: [], provider: null, model: null,
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
    const api = mockApi(swipeRoutes(() => items, (ids) => (items = items.filter((i) => !ids.includes(i.id)))));
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
      ...swipeRoutes(() => items, (ids) => (items = items.filter((i) => !ids.includes(i.id)))),
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
    const api = mockApi(swipeRoutes(() => items, () => (items = [makeItem('1', 90, { triageStatus: 'saved' })])));
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
    const api = mockApi(swipeRoutes(() => items, () => (items = [makeItem('1', 90)])));
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
    const api = mockApi(swipeRoutes(() => items, (ids) => (items = items.filter((i) => !ids.includes(i.id)))));
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
      expect(dialog).toHaveTextContent('“Job 1” at Company 1 goes back to saved. Its notes, stage history and interview date are deleted, and this can’t be undone.');
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
