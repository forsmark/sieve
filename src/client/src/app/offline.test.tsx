import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryHistory } from '@tanstack/react-router';
import { onlineManager } from '@tanstack/react-query';
import { STATUS, SilentEventSource, makeItem, mockApi } from '../test-utils';
import { resetToastsForTests } from '../lib/toast';
import { App, createQueryClient } from './App';

let online = true;

/** Takes the device off the network or back on, as the browser reports it. */
function setOnline(value: boolean) {
  online = value;
  act(() => void window.dispatchEvent(new Event(value ? 'online' : 'offline')));
}

/** The app with the query client of production, so mutations use its network mode. */
function renderOffline(items = [makeItem('1', 90), makeItem('2', 70)]) {
  const api = mockApi({
    'GET /api/auth/me': () => ({ authRequired: false, authenticated: true }),
    'GET /api/status': () => STATUS,
    'GET /api/sources': () => [],
    'GET /api/postings': () => ({ items, total: items.length, nextOffset: null }),
    'POST /api/postings/bulk': () => ({ previous: [{ id: '1', triageStatus: 'new' }] }),
  });
  // Without a network the browser's fetch rejects before any server answers.
  const served = api.fn.getMockImplementation()!;
  const attempts: string[] = [];
  api.fn.mockImplementation(async (input, init) => {
    attempts.push(`${init?.method ?? 'GET'} ${new URL(String(input), 'http://localhost').pathname}`);
    if (!online) throw new TypeError('Failed to fetch');
    return served(input, init);
  });
  vi.stubGlobal('EventSource', SilentEventSource);
  const queryClient = createQueryClient();
  const defaults = queryClient.getDefaultOptions();
  queryClient.setDefaultOptions({ ...defaults, queries: { ...defaults.queries, retry: false } });
  render(<App queryClient={queryClient} history={createMemoryHistory({ initialEntries: ['/jobs'] })} />);
  return { attempts };
}

describe('offline state', () => {
  beforeEach(() => {
    online = true;
    Object.defineProperty(window.navigator, 'onLine', { configurable: true, get: () => online });
    resetToastsForTests();
  });
  afterEach(() => {
    Reflect.deleteProperty(window.navigator, 'onLine');
    onlineManager.setOnline(true);
    vi.unstubAllGlobals();
    resetToastsForTests();
  });

  it('says "Offline" in the status bar when the device loses its network connection, and stops when it returns', async () => {
    renderOffline();
    const bar = within(await screen.findByRole('contentinfo', { name: 'System status' }));
    await bar.findByText(/^Last fetch/);
    expect(bar.queryByText('Offline')).not.toBeInTheDocument();

    setOnline(false);
    expect(bar.getByText('Offline')).toBeInTheDocument();
    expect(bar.queryByText(/^(Live|Connecting|Reconnecting)$/)).not.toBeInTheDocument();

    setOnline(true);
    expect(bar.queryByText('Offline')).not.toBeInTheDocument();
  });

  it('fails a triage while offline at once, puts the posting back, and says the device is offline', async () => {
    const { attempts } = renderOffline();
    const user = userEvent.setup();
    await screen.findByText('Job 1');

    setOnline(false);
    await user.keyboard('d');

    // The action ran instead of waiting for the network, and it failed.
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('The change was not saved. The device is offline.');
    expect(attempts).toContain('POST /api/postings/bulk');
    // The posting is back in the list, with the state from before the action.
    await waitFor(() => expect(screen.getByText('Job 1')).toBeInTheDocument());
    expect(screen.queryByText(/Dismissed “Job 1”/)).not.toBeInTheDocument();
  });
});
