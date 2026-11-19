import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { NotificationSettingsDto } from '../../../../shared/api';
import { STATUS, mockApi, renderApp } from '../../test-utils';
import { resetToastsForTests } from '../../lib/toast';

const OFF: NotificationSettingsDto = {
  enabled: false, server: 'https://ntfy.sh', topic: null, subscribeUrl: null, threshold: 75, windowSeconds: 60, appBaseUrl: 'http://localhost:3000',
};
const ON: NotificationSettingsDto = { ...OFF, enabled: true, topic: 'sieve-abc123', subscribeUrl: 'https://ntfy.sh/sieve-abc123' };

type Routes = Parameters<typeof mockApi>[0];

/**
 * Opens the settings page with a small notification server. The other sections of the page get no route,
 * so they show their error state; every query in this file is scoped to the notifications section.
 */
async function setup(initial: NotificationSettingsDto, routes: Routes = {}) {
  const server = { settings: initial };
  const api = mockApi({
    'GET /api/auth/me': () => ({ authRequired: false, authenticated: true }),
    'GET /api/status': () => STATUS,
    'GET /api/notifications': () => server.settings,
    'PUT /api/notifications': (c) => {
      server.settings = { ...server.settings, ...(c.body as Partial<NotificationSettingsDto>) };
      if (server.settings.enabled && !server.settings.topic) server.settings = { ...server.settings, topic: ON.topic, subscribeUrl: ON.subscribeUrl };
      return server.settings;
    },
    ...routes,
  });
  const user = userEvent.setup();
  renderApp('/settings');
  const section = within(await screen.findByRole('region', { name: 'Notifications' }));
  await section.findByRole('switch', { name: /Send notifications/ });
  const callsTo = (method: string, path: string) => api.calls.filter((c) => c.method === method && c.path === path);
  return { server, api, user, section, puts: () => callsTo('PUT', '/api/notifications'), callsTo };
}

describe('notification settings', () => {
  beforeEach(() => resetToastsForTests());
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    resetToastsForTests();
  });

  it('enables notifications with the switch and then shows the subscribe link', async () => {
    const { user, section, puts } = await setup(OFF);
    const toggle = section.getByRole('switch', { name: /Send notifications/ });
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    expect(section.queryByLabelText('Subscribe link')).not.toBeInTheDocument();
    expect(section.queryByRole('button', { name: 'Create new topic' })).not.toBeInTheDocument();

    await user.click(toggle);
    await waitFor(() => expect(puts()).toHaveLength(1));
    expect(puts()[0]!.body).toEqual({ enabled: true });

    await waitFor(() => expect(section.getByRole('switch', { name: /Send notifications/ })).toHaveAttribute('aria-checked', 'true'));
    expect(section.getByLabelText('Subscribe link')).toHaveValue(ON.subscribeUrl);
    expect(await screen.findByText('Notification settings saved.')).toBeInTheDocument();
  });

  it('disables notifications with the switch', async () => {
    const { user, section, puts } = await setup(ON);
    const toggle = section.getByRole('switch', { name: /Send notifications/ });
    expect(toggle).toHaveAttribute('aria-checked', 'true');
    await user.click(toggle);
    await waitFor(() => expect(puts()).toHaveLength(1));
    expect(puts()[0]!.body).toEqual({ enabled: false });
    await waitFor(() => expect(section.getByRole('switch', { name: /Send notifications/ })).toHaveAttribute('aria-checked', 'false'));
  });

  it('keeps the switch and reports the error when the server rejects the change', async () => {
    const { user, section } = await setup(OFF, {
      'PUT /api/notifications': () => new Response(JSON.stringify({ error: 'Disk full.' }), { status: 500 }),
    });
    await user.click(section.getByRole('switch', { name: /Send notifications/ }));
    expect(await screen.findByText(/Disk full/)).toBeInTheDocument();
    expect(section.getByRole('switch', { name: /Send notifications/ })).toHaveAttribute('aria-checked', 'false');
  });

  it('saves a new score threshold', async () => {
    const { user, section, puts } = await setup(ON);
    const threshold = section.getByLabelText('Score threshold');
    expect(threshold).toHaveValue(75);
    const save = section.getByRole('button', { name: 'Save' });
    expect(save).toBeDisabled();

    await user.clear(threshold);
    await user.type(threshold, '85');
    expect(save).toBeEnabled();
    await user.click(save);

    await waitFor(() => expect(puts()).toHaveLength(1));
    expect(puts()[0]!.body).toEqual({ server: 'https://ntfy.sh', threshold: 85, windowSeconds: 60, appBaseUrl: 'http://localhost:3000' });
    await waitFor(() => expect(section.getByLabelText('Score threshold')).toHaveValue(85));
    // The stored values are now the same as the form, so nothing is left to save.
    expect(section.getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  it('does not save a threshold outside 0 to 100', async () => {
    const { user, section, puts } = await setup(ON);
    const threshold = section.getByLabelText('Score threshold');
    await user.clear(threshold);
    await user.type(threshold, '150');
    expect(section.getByRole('button', { name: 'Save' })).toBeDisabled();
    await user.clear(threshold);
    await user.type(threshold, '100');
    expect(section.getByRole('button', { name: 'Save' })).toBeEnabled();
    expect(puts()).toHaveLength(0);
  });

  it('saves a new server address, without the spaces around it', async () => {
    const { user, section, puts } = await setup(ON);
    const address = section.getByLabelText('ntfy server');
    expect(address).toHaveValue('https://ntfy.sh');

    await user.clear(address);
    // An empty address cannot be saved.
    expect(section.getByRole('button', { name: 'Save' })).toBeDisabled();
    await user.type(address, 'https://ntfy.example.org ');
    await user.click(section.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(puts()).toHaveLength(1));
    expect(puts()[0]!.body).toEqual({ server: 'https://ntfy.example.org', threshold: 75, windowSeconds: 60, appBaseUrl: 'http://localhost:3000' });
    await waitFor(() => expect(section.getByLabelText('ntfy server')).toHaveValue('https://ntfy.example.org'));
  });

  it('shows the subscribe link read-only and copies it', async () => {
    const { user, section, puts } = await setup(ON);
    const link = section.getByLabelText('Subscribe link');
    expect(link).toHaveValue('https://ntfy.sh/sieve-abc123');
    expect(link).toHaveAttribute('readonly');

    await user.click(section.getByRole('button', { name: 'Copy' }));
    expect(await screen.findByText('Link copied.')).toBeInTheDocument();
    expect(await navigator.clipboard.readText()).toBe('https://ntfy.sh/sieve-abc123');
    expect(puts()).toHaveLength(0);
  });

  it('creates a new topic only after confirmation and shows the new link', async () => {
    const NEXT: NotificationSettingsDto = { ...ON, topic: 'sieve-zzz999', subscribeUrl: 'https://ntfy.sh/sieve-zzz999' };
    const { user, section, callsTo, server } = await setup(ON, {
      'POST /api/notifications/regenerate': () => {
        server.settings = NEXT;
        return NEXT;
      },
    });
    const regenerates = () => callsTo('POST', '/api/notifications/regenerate');

    await user.click(section.getByRole('button', { name: 'Create new topic' }));
    expect(regenerates()).toHaveLength(0);
    await user.click(section.getByRole('button', { name: 'Cancel' }));
    expect(regenerates()).toHaveLength(0);
    expect(section.getByLabelText('Subscribe link')).toHaveValue(ON.subscribeUrl);

    await user.click(section.getByRole('button', { name: 'Create new topic' }));
    await user.click(section.getByRole('button', { name: 'Yes, replace the topic' }));
    await waitFor(() => expect(regenerates()).toHaveLength(1));
    expect(regenerates()[0]!.body).toBeUndefined();

    await waitFor(() => expect(section.getByLabelText('Subscribe link')).toHaveValue('https://ntfy.sh/sieve-zzz999'));
    expect(await screen.findByText(/New topic created/)).toBeInTheDocument();
  });

  it('sends a test message and confirms it', async () => {
    const { user, section, callsTo } = await setup(ON, { 'POST /api/notifications/test': () => ({ ok: true }) });
    await user.click(section.getByRole('button', { name: 'Send test message' }));
    expect(await section.findByText('Test message sent. Check your device.')).toBeInTheDocument();
    expect(callsTo('POST', '/api/notifications/test')).toHaveLength(1);
  });

  it('shows the reason when the test message fails', async () => {
    const { user, section, callsTo } = await setup(ON, {
      'POST /api/notifications/test': () => new Response(JSON.stringify({ ok: false, error: 'ntfy answered 403.' }), { status: 502 }),
    });
    await user.click(section.getByRole('button', { name: 'Send test message' }));
    expect(await section.findByText('The test failed. ntfy answered 403.')).toBeInTheDocument();
    expect(callsTo('POST', '/api/notifications/test')).toHaveLength(1);
  });
});
