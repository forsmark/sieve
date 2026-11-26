import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ClearPreviewDto, LlmSettingsDto, SourceDto } from '../../../../shared/api';
import { STATUS, mockApi, renderApp } from '../../test-utils';
import { resetToastsForTests } from '../../lib/toast';

const LLM: LlmSettingsDto = {
  provider: 'local',
  baseUrl: 'http://localhost:11434',
  model: 'local-model',
  apiKey: '',
  claudeEffort: 'low',
  claudeModel: 'claude-haiku-5-5',
  writingModel: 'claude-fable-5-2',
  writingEffort: 'medium',
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
        provider: 'local',
        baseUrl: 'http://gpu-box:11434',
        model: 'qwen3',
      }),
    );
    const result = await section.findByText(/Provider:/);
    expect(result.closest('[role="status"]')).toHaveTextContent('Provider: responds. Model: not available.');
    expect(section.getByText('The model qwen3 is not installed.')).toBeInTheDocument();
  });
});

describe('postings', () => {
  beforeEach(() => resetToastsForTests());
  afterEach(() => {
    vi.unstubAllGlobals();
    resetToastsForTests();
  });

  /** Opens the settings page with the clear routes. The server keeps the counts the test gives until a clear. */
  function setupClear(preview: ClearPreviewDto, status = STATUS) {
    const server = { preview };
    const api = mockApi({
      'GET /api/auth/me': () => ({ authRequired: false, authenticated: true }),
      'GET /api/status': () => status,
      'GET /api/postings/clear': () => server.preview,
      'POST /api/postings/clear': (call) => {
        const confirmed = call.body as { delete: number; saved: number };
        if (confirmed.delete !== server.preview.delete || confirmed.saved !== server.preview.saved) {
          return new Response(JSON.stringify({ error: 'The postings changed after the page counted them. Check the new counts and delete again.' }), {
            status: 409,
          });
        }
        const result = { deleted: server.preview.delete, kept: server.preview.keep, backup: 'sieve-20261125-200000.db' };
        server.preview = { delete: 0, keep: server.preview.keep, withApplication: server.preview.withApplication, saved: 0 };
        return result;
      },
    });
    const user = userEvent.setup();
    renderApp('/settings');
    const posts = () => api.calls.filter((c) => c.method === 'POST' && c.path === '/api/postings/clear');
    return { user, posts, server };
  }

  it('states how many postings go and how many stay, and deletes nothing before the second click', async () => {
    const { user, posts } = setupClear({ delete: 406, keep: 6, withApplication: 6, saved: 4 });
    const section = within(await screen.findByRole('region', { name: 'Postings' }));

    expect(await section.findByText('412 postings are stored. 6 have an application and stay when you delete the others.')).toBeInTheDocument();
    expect(section.getByText('This includes 4 saved postings.')).toBeInTheDocument();
    await user.click(section.getByRole('button', { name: 'Delete 406 postings' }));

    expect(section.getByRole('button', { name: 'Yes, delete 406 postings' })).toBeInTheDocument();
    expect(section.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
    expect(posts()).toHaveLength(0);
  });

  it('deletes after the second click, names the backup, and shows the new counts', async () => {
    const { user, posts } = setupClear({ delete: 406, keep: 6, withApplication: 6, saved: 4 });
    const section = within(await screen.findByRole('region', { name: 'Postings' }));

    await user.click(await section.findByRole('button', { name: 'Delete 406 postings' }));
    await user.click(section.getByRole('button', { name: 'Yes, delete 406 postings' }));

    expect(await screen.findByText('Deleted 406 postings. Backup sieve-20261125-200000.db holds the earlier data.')).toBeInTheDocument();
    expect(posts()).toHaveLength(1);
    expect(posts()[0]!.body).toEqual({ delete: 406, saved: 4 });
    expect(await section.findByText('6 postings are stored. Each has an application, so none can be deleted.')).toBeInTheDocument();
    expect(section.getByRole('button', { name: 'Delete postings' })).toBeDisabled();
  });

  it('deletes nothing when the postings changed after the page counted them, and shows the new counts', async () => {
    const { user, posts, server } = setupClear({ delete: 406, keep: 6, withApplication: 6, saved: 4 });
    const section = within(await screen.findByRole('region', { name: 'Postings' }));

    await user.click(await section.findByRole('button', { name: 'Delete 406 postings' }));
    // A fetch adds postings while the confirmation is open.
    server.preview = { delete: 410, keep: 6, withApplication: 6, saved: 4 };
    await user.click(section.getByRole('button', { name: 'Yes, delete 406 postings' }));

    expect(await screen.findByText('The postings changed after the page counted them. Check the new counts and delete again.')).toBeInTheDocument();
    expect(posts()).toHaveLength(1);
    expect(await section.findByRole('button', { name: 'Delete 410 postings' })).toBeEnabled();
  });

  it('names the other listings of applied jobs apart from the postings with an application', async () => {
    setupClear({ delete: 20, keep: 3, withApplication: 2, saved: 0 });
    const section = within(await screen.findByRole('region', { name: 'Postings' }));

    expect(
      await section.findByText(
        '23 postings are stored. 2 have an application, and 1 is another listing of a job you applied to. These stay when you delete the others.',
      ),
    ).toBeInTheDocument();
  });

  it('disables the button while a fetch run is active and says why', async () => {
    setupClear({ delete: 10, keep: 0, withApplication: 0, saved: 0 }, { ...STATUS, activeRunId: 3 });
    const section = within(await screen.findByRole('region', { name: 'Postings' }));

    expect(await section.findByText('10 postings are stored.')).toBeInTheDocument();
    await waitFor(() => expect(section.getByRole('button', { name: 'Delete 10 postings' })).toBeDisabled());
    expect(section.getByText('A fetch is running. Delete the postings when it ends.')).toBeInTheDocument();
  });
});
