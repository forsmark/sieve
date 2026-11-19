import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import { STATUS, makeItem, mockApi, renderApp } from '../test-utils';

describe('first start', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('shows a setup step that asks for the CV while collected postings stay unscored', async () => {
    const items = [makeItem('1', null), makeItem('2', null)];
    mockApi({
      'GET /api/auth/me': () => ({ authRequired: false, authenticated: true }),
      'GET /api/status': () => ({ ...STATUS, hasCv: false, profileReady: false, searchTermCount: 1 }),
      'GET /api/sources': () => [],
      'GET /api/postings': () => ({ items, total: items.length, nextOffset: null }),
    });
    renderApp('/jobs');

    const guide = within(await screen.findByRole('complementary', { name: 'Getting started' }));
    const step = guide.getByRole('link', { name: 'Add your CV' });
    expect(step).toHaveAttribute('href', '/profile');
    // Search terms exist, so that step is done.
    expect(guide.getByText(/Add search terms/)).toHaveTextContent('(done)');

    // The postings show as waiting for a score, with no number.
    await screen.findByText('Job 1');
    const cards = within(screen.getByRole('list', { name: /Job postings/ })).getAllByRole('listitem');
    expect(cards).toHaveLength(2);
    for (const card of cards) {
      expect(within(card).getByText('Waiting')).toBeInTheDocument();
      expect(within(card).queryByText(/^\d+$/)).not.toBeInTheDocument();
    }
  });
});
