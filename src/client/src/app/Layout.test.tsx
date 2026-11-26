import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { StatusDto } from '../../../shared/api';
import { STATUS, mockApi, renderApp } from '../test-utils';
import { resetToastsForTests } from '../lib/toast';
import { mockMedia } from '../test/media';

/** Opens the app signed in, with or without a password. */
function setup(path: string, { password = true, status = STATUS }: { password?: boolean; status?: StatusDto } = {}) {
  let signedIn = true;
  const api = mockApi({
    'GET /api/auth/me': () => ({ authRequired: password, authenticated: signedIn }),
    'POST /api/auth/logout': () => {
      signedIn = false;
      return { ok: true };
    },
    'GET /api/status': () => ({ ...status, authRequired: password }),
    'GET /api/sources': () => [],
    'GET /api/postings': () => ({ items: [], total: 0, nextOffset: null }),
    'GET /api/applications': () => [],
  });
  const user = userEvent.setup();
  renderApp(path);
  const logouts = () => api.calls.filter((c) => c.method === 'POST' && c.path === '/api/auth/logout').length;
  return { user, logouts };
}

/** The top bar: the banner landmark with the wordmark, the navigation and, from 640px, "Log out". */
const topBar = async () => within(await screen.findByRole('banner'));
const nav = async () => within(await screen.findByRole('navigation', { name: 'Main' }));

describe('top bar', () => {
  beforeEach(() => resetToastsForTests());
  afterEach(() => {
    vi.unstubAllGlobals();
    resetToastsForTests();
  });

  it('holds "Log out" at 1440px, and logs out with it', async () => {
    mockMedia({ width: 1440 });
    const { user, logouts } = setup('/jobs');
    const bar = await topBar();
    await user.click(await bar.findByRole('button', { name: 'Log out' }));
    await waitFor(() => expect(logouts()).toBe(1));
    expect(await screen.findByRole('button', { name: 'Log in' })).toBeInTheDocument();
  });

  it('has no "Log out" at 430px on a touch screen, and shows it again when the window gets wide', async () => {
    const media = mockMedia({ coarse: true, width: 430 });
    setup('/jobs');
    const bar = await topBar();
    await bar.findByRole('link', { name: 'Board' });
    expect(bar.queryByRole('button', { name: 'Log out' })).not.toBeInTheDocument();

    act(() => media.set({ coarse: false, width: 1440 }));
    expect(bar.getByRole('button', { name: 'Log out' })).toBeInTheDocument();
  });

  it('has no "Log out" at any width when no password is set', async () => {
    mockMedia({ width: 1440 });
    setup('/jobs', { password: false });
    const bar = await topBar();
    await bar.findByRole('link', { name: 'Board' });
    expect(bar.queryByRole('button', { name: 'Log out' })).not.toBeInTheDocument();
  });

  it('keeps the top bar clear of the device status bar and the sides clear of the notch', async () => {
    setup('/jobs');
    const banner = await screen.findByRole('banner');
    // The bar keeps its 56px with the rule, as on main, and the top inset adds to it.
    // A content-box height of 56px would add the 1px rule and move every page down by 1px.
    expect(banner).toHaveClass('h-[calc(3.5rem+env(safe-area-inset-top))]', 'pt-[env(safe-area-inset-top)]', 'border-b');
    expect(banner).not.toHaveClass('box-content');
    expect(banner.parentElement).toHaveClass('pr-[env(safe-area-inset-right)]', 'pl-[env(safe-area-inset-left)]');
  });

  it('counts the open applications beside "Board", not the applied postings', async () => {
    setup('/jobs', { status: { ...STATUS, counts: { ...STATUS.counts, applied: 5, openApplications: 2 } } });
    const board = (await nav()).getByRole('link', { name: /^Board/ });
    const count = await within(board).findByLabelText('2 open applications');
    expect(count).toHaveTextContent('2');
    expect(within(board).queryByLabelText(/5/)).not.toBeInTheDocument();
  });

  it('names a single open application in the singular', async () => {
    setup('/jobs', { status: { ...STATUS, counts: { ...STATUS.counts, applied: 1, openApplications: 1 } } });
    const board = (await nav()).getByRole('link', { name: /^Board/ });
    expect(await within(board).findByLabelText('1 open application')).toHaveTextContent('1');
  });

  it('shows no count beside "Board" when no application is open', async () => {
    setup('/jobs', { status: { ...STATUS, counts: { ...STATUS.counts, applied: 3, openApplications: 0 } } });
    const n = await nav();
    // The unread count of Jobs shows, so the status has arrived.
    await n.findByLabelText('3 unread');
    expect(within(n.getByRole('link', { name: /^Board/ })).queryByLabelText(/open application/)).not.toBeInTheDocument();
  });
});
