import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { STATUS, makeItem, mockApi, renderApp } from '../test-utils';
import { resetToastsForTests } from '../lib/toast';

/** A server with a password. Every route but the login routes answers 401 until the login succeeds. */
function setup() {
  const session = { open: false };
  const guarded = (data: () => unknown) => () => (session.open ? data() : new Response(JSON.stringify({ error: 'Log in first.' }), { status: 401 }));
  const api = mockApi({
    'GET /api/auth/me': () => ({ authRequired: true, authenticated: session.open }),
    'POST /api/auth/login': (c) => {
      if ((c.body as { password: string }).password !== 'correct horse') return new Response(JSON.stringify({ error: 'Wrong password.' }), { status: 401 });
      session.open = true;
      return { ok: true };
    },
    'GET /api/status': guarded(() => ({ ...STATUS, authRequired: true })),
    'GET /api/sources': guarded(() => []),
    'GET /api/postings': guarded(() => ({ items: [makeItem('1', 90)], total: 1, nextOffset: null })),
  });
  return { api, session };
}

describe('login screen', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    resetToastsForTests();
  });

  it.each(['/jobs', '/jobs?id=1', '/board', '/profile', '/settings', '/activity'])(
    'shows only the login form on %s to a visitor without a session',
    async (path) => {
      const { api } = setup();
      renderApp(path);
      expect(await screen.findByLabelText('Password')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Log in' })).toBeInTheDocument();

      expect(screen.queryByRole('navigation', { name: 'Main' })).not.toBeInTheDocument();
      expect(screen.queryByRole('link', { name: 'Jobs' })).not.toBeInTheDocument();
      expect(screen.queryByRole('link', { name: 'Settings' })).not.toBeInTheDocument();
      expect(screen.queryByRole('list', { name: /Job postings/ })).not.toBeInTheDocument();
      expect(screen.queryByRole('contentinfo', { name: 'System status' })).not.toBeInTheDocument();
      expect(screen.queryByText('Job 1')).not.toBeInTheDocument();
      // The page asks the server for nothing but the session state.
      expect(api.calls.map((c) => `${c.method} ${c.path}`)).toEqual(['GET /api/auth/me']);
    },
  );

  it('shows the navigation and the job list after the user logs in', async () => {
    const { api } = setup();
    const user = userEvent.setup();
    renderApp('/jobs');
    await user.type(await screen.findByLabelText('Password'), 'correct horse');
    await user.click(screen.getByRole('button', { name: 'Log in' }));

    expect(await screen.findByRole('navigation', { name: 'Main' })).toBeInTheDocument();
    expect(await screen.findByText('Job 1')).toBeInTheDocument();
    expect(screen.queryByLabelText('Password')).not.toBeInTheDocument();
    await waitFor(() => expect(api.calls.find((c) => c.path === '/api/auth/login')?.body).toEqual({ password: 'correct horse' }));
  });
});
