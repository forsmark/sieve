import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { PostingListItem } from '../../../../shared/api';
import { STATUS, makeItem, mockApi, renderApp } from '../../test-utils';
import { resetToastsForTests } from '../../lib/toast';

function rowOf(title: string): HTMLElement {
  return screen.getByText(title).closest('[role="listitem"]') as HTMLElement;
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
    const items = [makeItem('1', 90), makeItem('2', 70), makeItem('3', 60)];
    const api = mockApi({
      ...baseRoutes(() => items),
      'POST /api/postings/bulk': (c) => ({ previous: (c.body as { ids: string[] }).ids.map((id) => ({ id, triageStatus: 'new' })) }),
      'POST /api/postings/restore': () => ({ ok: true }),
    });
    const user = userEvent.setup();
    renderApp('/jobs');
    await screen.findByText('Job 1');
    await user.keyboard('x');
    await user.keyboard('j');
    await user.keyboard('x');
    expect(screen.getByText('2 selected')).toBeInTheDocument();
    await user.click(within(screen.getByRole('toolbar', { name: 'Bulk actions' })).getByRole('button', { name: 'Dismiss' }));
    await screen.findByText(/Dismissed 2 postings/);
    expect(api.calls.find((c) => c.path === '/api/postings/bulk')?.body).toEqual({ ids: ['1', '2'], action: 'dismiss' });
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
});
