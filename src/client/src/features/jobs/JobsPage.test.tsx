import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
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
