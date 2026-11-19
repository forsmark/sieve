import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import { createMemoryHistory } from '@tanstack/react-router';
import { QueryClient } from '@tanstack/react-query';
import type { ServerEvent, StatusDto } from '../../../shared/api';
import { STATUS, mockApi } from '../test-utils';
import { resetToastsForTests } from '../lib/toast';
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
function setup(initial: StatusDto) {
  const server = { status: initial };
  const api = mockApi({
    'GET /api/auth/me': () => ({ authRequired: false, authenticated: true }),
    'GET /api/status': () => server.status,
    'GET /api/sources': () => [],
    'GET /api/postings': () => ({ items: [], total: 0, nextOffset: null }),
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
});
