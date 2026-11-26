import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { PostingListItem } from '../../../../shared/api';
import { STATUS, makeItem, mockApi, renderApp } from '../../test-utils';
import { resetToastsForTests } from '../../lib/toast';
import { mockMedia } from '../../test/media';

/** Three postings: two remote, one on site. The list answers the work arrangement filter. */
function setup() {
  const items: PostingListItem[] = [makeItem('1', 90), makeItem('2', 70), makeItem('3', 60, { workArrangement: 'onsite' })];
  return mockApi({
    'GET /api/auth/me': () => ({ authRequired: false, authenticated: true }),
    'GET /api/status': () => STATUS,
    'GET /api/sources': () => [],
    'GET /api/postings': (_c, url) => {
      const work = url.searchParams.get('work');
      const shown = work ? items.filter((i) => i.workArrangement === work) : items;
      return { items: shown, total: shown.length, nextOffset: null };
    },
  });
}

const filtersButton = () => screen.getByRole('button', { name: /^Filters/ });

describe('filter sheet below 640px', () => {
  beforeEach(() => resetToastsForTests());
  afterEach(() => {
    vi.unstubAllGlobals();
    resetToastsForTests();
  });

  it('starts closed on a phone, also with filters in the address, and the button counts them', async () => {
    mockMedia({ coarse: true, width: 430 });
    setup();
    renderApp('/jobs?work=remote&minScore=70');
    await screen.findByText('Job 1');
    expect(filtersButton()).toHaveTextContent('Filters (2)');
    expect(filtersButton()).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('dialog', { name: 'Filters' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Work arrangement')).not.toBeInTheDocument();
  });

  it('opens the filters as a full-screen sheet whose button shows the live count and closes it', async () => {
    mockMedia({ coarse: true, width: 430 });
    setup();
    const user = userEvent.setup();
    const { history } = renderApp('/jobs');
    await screen.findByText('Job 1');

    await user.click(filtersButton());
    const sheet = within(await screen.findByRole('dialog', { name: 'Filters' }));
    expect(filtersButton()).toHaveAttribute('aria-expanded', 'true');
    expect(sheet.getByRole('heading', { name: 'Filters' })).toBeInTheDocument();
    expect(sheet.getByRole('button', { name: 'Show 3 postings' })).toHaveClass('h-11', 'w-full');
    // The status filters are chips of the shared control.
    expect(sheet.getByRole('checkbox', { name: 'Dismissed' }).closest('label')).toHaveClass('touch:h-11');

    // A filter writes to the address at once, and the count follows.
    await user.selectOptions(sheet.getByLabelText('Work arrangement'), 'onsite');
    await waitFor(() => expect(history.location.search).toBe('?work=onsite'));
    const show = await sheet.findByRole('button', { name: 'Show 1 posting' });

    await user.click(show);
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Filters' })).not.toBeInTheDocument());
    expect(filtersButton()).toHaveAttribute('aria-expanded', 'false');
    expect(filtersButton()).toHaveTextContent('Filters (1)');
    expect(screen.getByText('Job 3')).toBeInTheDocument();
    expect(screen.queryByText('Job 1')).not.toBeInTheDocument();
  });

  it('closes the sheet with its Close button and keeps the filters', async () => {
    mockMedia({ coarse: true, width: 430 });
    setup();
    const user = userEvent.setup();
    const { history } = renderApp('/jobs?work=remote');
    await screen.findByText('Job 1');
    await user.click(filtersButton());
    const sheet = within(await screen.findByRole('dialog', { name: 'Filters' }));
    expect(sheet.getByLabelText('Work arrangement')).toHaveValue('remote');
    await user.click(sheet.getByRole('button', { name: 'Close filters' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Filters' })).not.toBeInTheDocument());
    expect(history.location.search).toBe('?work=remote');
  });

  it('keeps the filter panel in the page and opens it on load with filters in the address from 640px', async () => {
    mockMedia({ width: 1440 });
    setup();
    renderApp('/jobs?work=remote&minScore=70');
    await screen.findByText('Job 1');
    expect(filtersButton()).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByLabelText('Work arrangement')).toBeVisible();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Show \d+ posting/ })).not.toBeInTheDocument();
  });

  it('opens and closes the panel in the page at 640px', async () => {
    mockMedia({ width: 640 });
    setup();
    const user = userEvent.setup();
    renderApp('/jobs');
    await screen.findByText('Job 1');
    expect(screen.getByLabelText('Work arrangement')).not.toBeVisible();
    await user.click(filtersButton());
    expect(screen.getByLabelText('Work arrangement')).toBeVisible();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await user.click(filtersButton());
    expect(screen.getByLabelText('Work arrangement')).not.toBeVisible();
  });
});
