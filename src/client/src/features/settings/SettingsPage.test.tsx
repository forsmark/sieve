import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { LlmSettingsDto, SourceDto } from '../../../../shared/api';
import { STATUS, mockApi, renderApp } from '../../test-utils';
import { resetToastsForTests } from '../../lib/toast';

const LLM: LlmSettingsDto = {
  provider: 'local', baseUrl: 'http://localhost:11434', model: 'local-model', apiKey: '', claudeEffort: 'low',
  claudeModel: 'claude-haiku-5-5', writingModel: 'claude-fable-5-2', writingEffort: 'medium',
};

function source(id: string, name: string, keywords: boolean): SourceDto {
  return { id, name, enabled: true, supports: { keywords, region: true }, lastResult: null, lastRunAt: null };
}

/**
 * Opens the settings page with the routes of the sources and the language model.
 * The other sections of the page get no route, so they show their error state.
 */
function setup(settings: LlmSettingsDto, sources: SourceDto[] = []) {
  const api = mockApi({
    'GET /api/auth/me': () => ({ authRequired: false, authenticated: true }),
    'GET /api/status': () => STATUS,
    'GET /api/sources': () => sources,
    'GET /api/llm': () => ({ settings, available: true }),
  });
  const user = userEvent.setup();
  renderApp('/settings');
  return { api, user };
}

describe('settings', () => {
  beforeEach(() => resetToastsForTests());
  afterEach(() => {
    vi.unstubAllGlobals();
    resetToastsForTests();
  });

  it('states that data leaves the machine when the user selects the Claude Code provider, and not for the local provider', async () => {
    const { user, api } = setup(LLM);
    const section = within(await screen.findByRole('region', { name: 'Language model' }));
    const local = await section.findByRole('radio', { name: 'Local endpoint' });
    const claude = section.getByRole('radio', { name: 'Claude Code' });
    expect(local).toBeChecked();
    expect(section.queryByText('Your data leaves this machine.')).not.toBeInTheDocument();

    await user.click(claude);
    expect(claude).toBeChecked();
    expect(section.getByText('Your data leaves this machine.')).toBeInTheDocument();
    expect(section.getByText(/posting text and your profile data are sent to Anthropic's hosted service/)).toBeInTheDocument();

    await user.click(local);
    expect(local).toBeChecked();
    expect(section.queryByText('Your data leaves this machine.')).not.toBeInTheDocument();
    // The selection alone stores nothing.
    expect(api.calls.filter((c) => c.method !== 'GET')).toHaveLength(0);
  });

  it('shows the statement at once when Claude Code is the stored provider', async () => {
    setup({ ...LLM, provider: 'claude-code' });
    const section = within(await screen.findByRole('region', { name: 'Language model' }));
    expect(await section.findByRole('radio', { name: 'Claude Code' })).toBeChecked();
    expect(section.getByText('Your data leaves this machine.')).toBeInTheDocument();
  });

  it('warns the user when no search terms are saved', async () => {
    mockApi({
      'GET /api/auth/me': () => ({ authRequired: false, authenticated: true }),
      'GET /api/status': () => STATUS,
      'GET /api/sources': () => [],
      'GET /api/llm': () => ({ settings: LLM, available: true }),
      'GET /api/search': () => ({ terms: [], region: 'Denmark' }),
    });
    renderApp('/settings');
    const section = within(await screen.findByRole('region', { name: 'Search' }));
    expect(await section.findByText(/^No search terms yet\./)).toBeInTheDocument();
    expect(section.queryByRole('list', { name: 'Search terms' })).not.toBeInTheDocument();
  });

  it('shows that a source without keyword search ignores the search terms', async () => {
    setup(LLM, [source('remoteok', 'Remote OK', false), source('jobindex', 'Jobindex', true)]);
    const section = within(await screen.findByRole('region', { name: 'Sources' }));
    await section.findByRole('switch', { name: /Remote OK/ });
    const rowOf = (name: RegExp) => {
      const row = section.getAllByRole('listitem').find((li) => within(li).queryByRole('switch', { name }));
      if (!row) throw new Error(`No source row matches ${name}.`);
      return within(row);
    };

    expect(rowOf(/Remote OK/).getByText(/^Ignores search terms\b/)).toBeInTheDocument();
    expect(rowOf(/Remote OK/).queryByText(/Uses search terms/)).not.toBeInTheDocument();
    expect(rowOf(/Jobindex/).getByText(/^Uses search terms\b/)).toBeInTheDocument();
    expect(rowOf(/Jobindex/).queryByText(/Ignores search terms/)).not.toBeInTheDocument();
  });

  it('tests a provider with the settings the user entered and reports whether it responds and whether the model is available', async () => {
    const api = mockApi({
      'GET /api/auth/me': () => ({ authRequired: false, authenticated: true }),
      'GET /api/status': () => STATUS,
      'GET /api/sources': () => [],
      'GET /api/llm': () => ({ settings: { ...LLM, provider: 'claude-code' }, available: true }),
      'PUT /api/llm': (c) => ({
        saved: true,
        health: { reachable: true, modelAvailable: false, detail: 'The model qwen3 is not installed.' },
        settings: { ...LLM, ...(c.body as object) },
      }),
    });
    const user = userEvent.setup();
    renderApp('/settings');
    const section = within(await screen.findByRole('region', { name: 'Language model' }));
    await user.click(await section.findByRole('radio', { name: 'Local endpoint' }));
    const address = section.getByLabelText('Endpoint address');
    await user.clear(address);
    await user.type(address, 'http://gpu-box:11434');
    const model = section.getByLabelText('Model');
    await user.clear(model);
    await user.type(model, 'qwen3');
    await user.click(section.getByRole('button', { name: 'Save and test' }));

    // The request carries the entered settings, and the result names both checks.
    await waitFor(() =>
      expect(api.calls.find((c) => c.method === 'PUT' && c.path === '/api/llm')?.body).toMatchObject({
        provider: 'local', baseUrl: 'http://gpu-box:11434', model: 'qwen3',
      }),
    );
    const result = await section.findByText(/Provider:/);
    expect(result.closest('[role="status"]')).toHaveTextContent('Provider: responds. Model: not available.');
    expect(section.getByText('The model qwen3 is not installed.')).toBeInTheDocument();
  });
});
