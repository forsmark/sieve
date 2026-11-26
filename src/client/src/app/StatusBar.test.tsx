import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryHistory } from '@tanstack/react-router';
import { QueryClient, onlineManager } from '@tanstack/react-query';
import type { RunDto, ServerEvent, StatusDto } from '../../../shared/api';
import { STATUS, mockApi } from '../test-utils';
import { resetToastsForTests } from '../lib/toast';
import { mockMedia } from '../test/media';
import { App } from './App';

/** An event stream that the test writes to. */
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

/** Opens the app with a status that the test can change, as the server does when the provider changes. */
function setup(initial: StatusDto, routes: Parameters<typeof mockApi>[0] = {}) {
  const server = { status: initial };
  const api = mockApi({
    'GET /api/auth/me': () => ({ authRequired: false, authenticated: true }),
    'GET /api/status': () => server.status,
    'GET /api/sources': () => [],
    'GET /api/postings': () => ({ items: [], total: 0, nextOffset: null }),
    'GET /api/activity': () => ({ runs: [], failedTasks: [], notifications: [] }),
    'GET /api/logs': () => [],
    ...routes,
  });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(<App queryClient={queryClient} history={createMemoryHistory({ initialEntries: ['/jobs'] })} />);
  const statusCalls = () => api.calls.filter((c) => c.path === '/api/status').length;
  return { server, statusCalls };
}

const bar = () => screen.findByRole('contentinfo', { name: 'System status' });

describe('status bar', () => {
  beforeEach(() => {
    FakeEventSource.instances = [];
    vi.stubGlobal('EventSource', FakeEventSource);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    resetToastsForTests();
  });

  it('shows that the model is unavailable when the provider is down', async () => {
    setup({ ...STATUS, llmAvailable: false });
    const footer = within(await bar());
    expect(await footer.findByText('Model unavailable')).toBeInTheDocument();
    expect(footer.queryByText('Model available')).not.toBeInTheDocument();
  });

  it('shows that the model is available when the provider responds', async () => {
    setup({ ...STATUS, llmAvailable: true });
    const footer = within(await bar());
    expect(await footer.findByText('Model available')).toBeInTheDocument();
    expect(footer.queryByText('Model unavailable')).not.toBeInTheDocument();
  });

  it('changes to "Model available" when an llm.status event arrives after the provider returns', async () => {
    const { server, statusCalls } = setup({ ...STATUS, llmAvailable: false });
    const footer = within(await bar());
    expect(await footer.findByText('Model unavailable')).toBeInTheDocument();
    const before = statusCalls();

    // Without an event, the bar keeps what it has.
    server.status = { ...STATUS, llmAvailable: true };
    expect(FakeEventSource.instances).toHaveLength(1);
    expect(FakeEventSource.instances[0]!.url).toBe('/api/events');
    expect(footer.getByText('Model unavailable')).toBeInTheDocument();

    act(() => FakeEventSource.instances[0]!.send({ type: 'llm.status', available: true }));
    expect(await footer.findByText('Model available')).toBeInTheDocument();
    expect(footer.queryByText('Model unavailable')).not.toBeInTheDocument();
    await waitFor(() => expect(statusCalls()).toBe(before + 1));
  });

  it('changes to "Model unavailable" when an llm.status event reports that the provider is down', async () => {
    const { server } = setup({ ...STATUS, llmAvailable: true });
    const footer = within(await bar());
    expect(await footer.findByText('Model available')).toBeInTheDocument();
    server.status = { ...STATUS, llmAvailable: false };
    act(() => FakeEventSource.instances[0]!.send({ type: 'llm.status', available: false }));
    expect(await footer.findByText('Model unavailable')).toBeInTheDocument();
  });

  it('shows an active fetch run and the progress of each source when a run.progress event arrives', async () => {
    const server: { status: StatusDto; runs: RunDto[] } = { status: { ...STATUS, activeRunId: null }, runs: [] };
    mockApi({
      'GET /api/auth/me': () => ({ authRequired: false, authenticated: true }),
      'GET /api/status': () => server.status,
      'GET /api/sources': () => [],
      'GET /api/postings': () => ({ items: [], total: 0, nextOffset: null }),
      'GET /api/runs': () => server.runs,
    });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    render(<App queryClient={queryClient} history={createMemoryHistory({ initialEntries: ['/jobs'] })} />);
    const footer = within(await bar());
    expect(await footer.findByText(/^Last fetch/)).toBeInTheDocument();
    expect(footer.queryByText('Fetching')).not.toBeInTheDocument();

    // A run starts. The server reports it, and the bar follows without a reload.
    server.status = { ...STATUS, activeRunId: 3 };
    server.runs = [
      {
        id: 3,
        trigger: 'manual',
        state: 'running',
        startedAt: '2026-11-10T14:00:00Z',
        endedAt: null,
        sources: [
          { source: 'jobindex', state: 'completed', found: 41, added: 7, invalid: 0, error: null },
          { source: 'remoteok', state: 'running', found: 13, added: 4, invalid: 0, error: null },
        ],
      },
    ];
    act(() => FakeEventSource.instances[0]!.send({ type: 'run.progress', runId: 3 }));
    expect(await footer.findByText('Fetching')).toBeInTheDocument();
    expect(await footer.findByText('Jobindex 41 found, Remote OK running')).toBeInTheDocument();
    expect(footer.getByRole('button', { name: 'Fetch now' })).toBeDisabled();

    // The next event reports progress of the running source.
    server.runs = [{ ...server.runs[0]!, sources: [server.runs[0]!.sources[0]!, { ...server.runs[0]!.sources[1]!, state: 'completed', found: 20 }] }];
    act(() => FakeEventSource.instances[0]!.send({ type: 'run.progress', runId: 3 }));
    expect(await footer.findByText('Jobindex 41 found, Remote OK 20 found')).toBeInTheDocument();
  });
});

describe('status bar on a phone', () => {
  let online = true;
  beforeEach(() => {
    online = true;
    Object.defineProperty(window.navigator, 'onLine', { configurable: true, get: () => online });
    FakeEventSource.instances = [];
    vi.stubGlobal('EventSource', FakeEventSource);
  });
  afterEach(() => {
    Reflect.deleteProperty(window.navigator, 'onLine');
    onlineManager.setOnline(true);
    vi.unstubAllGlobals();
    resetToastsForTests();
  });

  /** The one link of the bar below 640px. */
  const line = async () => within(await bar()).getByRole('link', { name: /open Activity/ });

  it('shows one line of status that leads to Activity, without the buttons, at 430px on a touch screen', async () => {
    mockMedia({ coarse: true, width: 430 });
    const user = userEvent.setup();
    setup({ ...STATUS, llmAvailable: true });
    const footer = within(await bar());
    await footer.findByText(/^Last fetch/);

    // The whole bar is one link, at least 44px high, and the safe area adds to it below.
    const link = await line();
    expect(footer.getAllByRole('link')).toEqual([link]);
    expect(link).toHaveAttribute('href', '/activity');
    expect(link).toHaveClass('min-h-11', 'box-content', 'pb-[env(safe-area-inset-bottom)]');
    expect(link).toHaveTextContent(/^Last fetch never.*Model available.*(Live|Connecting|Reconnecting), open Activity$/);
    expect(footer.queryByRole('button')).not.toBeInTheDocument();
    expect(footer.queryByText(/^Queue/)).not.toBeInTheDocument();

    await user.click(link);
    expect(await screen.findByRole('heading', { level: 1, name: 'Activity' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Fetch now' })).toBeInTheDocument();
  });

  it('keeps the faults in its line: the model, paused matching, a fetch, and "Offline"', async () => {
    mockMedia({ coarse: true, width: 430 });
    setup({ ...STATUS, llmAvailable: false, matchingPaused: true, activeRunId: 4 }, { 'GET /api/runs': () => [] });
    const footer = within(await bar());
    expect(await footer.findByText('Model unavailable')).toBeInTheDocument();
    expect(footer.getByText('Matching paused')).toBeInTheDocument();
    expect(footer.getByText('Fetching')).toBeInTheDocument();
    expect(footer.getByText(/^(Live|Connecting|Reconnecting)$/)).toBeInTheDocument();

    online = false;
    act(() => void window.dispatchEvent(new Event('offline')));
    expect(footer.getByText('Offline')).toBeInTheDocument();
    expect(footer.queryByText(/^(Live|Connecting|Reconnecting)$/)).not.toBeInTheDocument();
    expect(await line()).toHaveTextContent('Offline');
  });

  it('says that the status is unavailable when it cannot be loaded', async () => {
    mockMedia({ coarse: true, width: 430 });
    setup(STATUS, { 'GET /api/status': () => new Response(JSON.stringify({ error: 'Database is locked.' }), { status: 500 }) });
    const footer = within(await bar());
    expect(await footer.findByText(/^Status unavailable: .*Database is locked\./)).toBeInTheDocument();
    expect(await line()).toHaveTextContent('Status unavailable');
  });

  it('shows the status items with "Fetch now" and "Pause" at 1440px, and one line when the window gets narrow', async () => {
    const media = mockMedia({ width: 1440 });
    setup({ ...STATUS, llmAvailable: true });
    const footer = within(await bar());
    await footer.findByText(/^Last fetch/);
    expect(footer.getByRole('button', { name: 'Fetch now' })).toBeInTheDocument();
    expect(footer.getByRole('button', { name: 'Pause' })).toBeInTheDocument();
    expect(footer.getByText(/^Queue/)).toBeInTheDocument();
    expect(footer.queryByRole('link', { name: /open Activity/ })).not.toBeInTheDocument();

    act(() => media.set({ width: 600 }));
    expect(await line()).toBeInTheDocument();
    expect(within(await bar()).queryByRole('button')).not.toBeInTheDocument();
  });
});
