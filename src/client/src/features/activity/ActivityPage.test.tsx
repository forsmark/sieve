import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ActivityDto, FailedTaskDto, LogDto, RunDto, StatusDto } from '../../../../shared/api';
import { STATUS, mockApi, renderApp } from '../../test-utils';
import { resetToastsForTests } from '../../lib/toast';
import { mockMedia } from '../../test/media';

const RUNS: RunDto[] = [
  {
    id: 2,
    trigger: 'manual',
    state: 'completed',
    startedAt: '2026-11-10T08:00:00Z',
    endedAt: '2026-11-10T08:01:30Z',
    sources: [
      { source: 'jobindex', state: 'completed', found: 41, added: 7, invalid: 2, error: null },
      { source: 'linkedin', state: 'failed', found: 0, added: 0, invalid: 0, error: 'The site answered 429.' },
      { source: 'remotive', state: 'skipped', found: 0, added: 0, invalid: 0, error: 'No search terms.' },
    ],
  },
  {
    id: 3,
    trigger: 'schedule',
    state: 'running',
    startedAt: '2026-11-10T14:00:00Z',
    endedAt: null,
    sources: [{ source: 'remoteok', state: 'running', found: 13, added: 4, invalid: 0, error: null }],
  },
];

const TASKS: FailedTaskDto[] = [
  { id: 5, kind: 'score', subjectId: 'p5', subjectTitle: 'Frontend developer', attempts: 3, lastError: 'The model did not answer.', finishedAt: null },
  { id: 6, kind: 'enrich', subjectId: 'p6', subjectTitle: null, attempts: 2, lastError: null, finishedAt: null },
];

const LOGS: LogDto[] = [
  { id: 1, level: 'info', message: 'Fetch run 2 started.', createdAt: '2026-11-10T08:00:00Z' },
  { id: 2, level: 'warn', message: 'Jobindex returned 2 invalid postings.', createdAt: '2026-11-10T08:00:20Z' },
  { id: 3, level: 'error', message: 'LinkedIn failed with status 429.', createdAt: '2026-11-10T08:00:40Z' },
];

const EMPTY: ActivityDto = { runs: [], failedTasks: [], notifications: [] };

type Routes = Parameters<typeof mockApi>[0];

function setup(activity: () => ActivityDto, routes: Routes = {}, status: StatusDto = STATUS) {
  const logLevels: Array<string | null> = [];
  const api = mockApi({
    'GET /api/auth/me': () => ({ authRequired: false, authenticated: true }),
    'GET /api/status': () => status,
    'GET /api/activity': () => activity(),
    'GET /api/logs': (_c, url) => {
      const level = url.searchParams.get('level');
      logLevels.push(level);
      return level ? LOGS.filter((l) => l.level === level) : LOGS;
    },
    ...routes,
  });
  const user = userEvent.setup();
  renderApp('/activity');
  const count = (method: string, path: string) => api.calls.filter((c) => c.method === method && c.path === path).length;
  return { api, user, logLevels, count };
}

const region = async (name: string) => within(await screen.findByRole('region', { name }));

/** The cells of the table row that starts with this source name. */
function cellsOf(table: HTMLElement, source: string): string[] {
  const row = within(table).getByRole('cell', { name: source }).closest('tr') as HTMLElement;
  return within(row)
    .getAllByRole('cell')
    .map((c) => c.textContent ?? '');
}

describe('activity page', () => {
  beforeEach(() => resetToastsForTests());
  afterEach(() => {
    vi.unstubAllGlobals();
    resetToastsForTests();
  });

  it('lists the fetch runs with the result of each source', async () => {
    setup(() => ({ ...EMPTY, runs: RUNS }));
    const runs = await region('Fetch runs');
    const tables = await runs.findAllByRole('table');
    expect(tables).toHaveLength(2);
    expect(
      within(tables[0]!)
        .getAllByRole('columnheader')
        .map((h) => h.textContent),
    ).toEqual(['Source', 'State', 'Found', 'New', 'Invalid']);

    // The first run: one source completed, one failed with its error, one skipped.
    const first = tables[0]!.closest('li') as HTMLElement;
    expect(within(first).getAllByText('Completed').length).toBeGreaterThan(0);
    expect(first).toHaveTextContent('Started by you');
    expect(first).toHaveTextContent('took 90 s');
    expect(within(tables[0]!).getAllByRole('row')).toHaveLength(4);
    expect(cellsOf(tables[0]!, 'Jobindex')).toEqual(['Jobindex', 'Completed', '41', '7', '2']);
    expect(cellsOf(tables[0]!, 'LinkedIn')).toEqual(['LinkedIn', 'FailedThe site answered 429.', '0', '0', '0']);
    expect(cellsOf(tables[0]!, 'Remotive')).toEqual(['Remotive', 'SkippedNo search terms.', '0', '0', '0']);

    // The second run is still running and came from the schedule.
    const second = tables[1]!.closest('li') as HTMLElement;
    expect(second).toHaveTextContent('Trigger: schedule');
    expect(second).not.toHaveTextContent(/took \d+ s/);
    expect(cellsOf(tables[1]!, 'Remote OK')).toEqual(['Remote OK', 'Running', '13', '4', '0']);
  });

  it('says so when there are no runs, no failed work, and no notifications', async () => {
    setup(() => EMPTY);
    expect((await region('Fetch runs')).getByText('No fetch runs yet. Use Fetch now above to start one.')).toBeInTheDocument();
    expect((await region('Failed work')).getByText('Nothing failed.')).toBeInTheDocument();
    expect((await region('Notifications')).getByText('No notifications sent yet.')).toBeInTheDocument();
  });

  it('lists failed work with its error and a link to the posting', async () => {
    setup(() => ({ ...EMPTY, failedTasks: TASKS }));
    const failed = await region('Failed work');
    const items = await failed.findAllByRole('listitem');
    expect(items).toHaveLength(2);

    expect(items[0]).toHaveTextContent('Score');
    expect(items[0]).toHaveTextContent('The model did not answer.');
    expect(items[0]).toHaveTextContent('3 attempts');
    const link = within(items[0]!).getByRole('link', { name: 'Frontend developer' });
    const href = new URL(link.getAttribute('href')!, 'http://localhost');
    expect(href.pathname).toBe('/jobs');
    expect(href.searchParams.get('id')).toBe('p5');
    expect(href.searchParams.get('status')).toBe('all');

    // Without a title, the identifier of the subject is shown.
    expect(items[1]).toHaveTextContent('Fetch description');
    expect(items[1]).toHaveTextContent('p6');
    expect(within(items[1]!).queryByRole('link')).not.toBeInTheDocument();
    expect(items[1]).toHaveTextContent('2 attempts');
  });

  it('retries a failed task, then reloads the list', async () => {
    let tasks = TASKS;
    const { api, user, count } = setup(() => ({ ...EMPTY, failedTasks: tasks }), {
      'POST /api/activity/tasks/5/retry': () => {
        tasks = tasks.filter((t) => t.id !== 5);
        return { ok: true };
      },
    });
    const failed = await region('Failed work');
    const items = await failed.findAllByRole('listitem');
    expect(count('GET', '/api/activity')).toBe(1);

    await user.click(within(items[0]!).getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(count('POST', '/api/activity/tasks/5/retry')).toBe(1));
    expect(api.calls.some((c) => c.path === '/api/activity/tasks/6/retry')).toBe(false);
    expect(await screen.findByText('The work is queued again.')).toBeInTheDocument();

    await waitFor(() => expect(failed.queryByText('Frontend developer')).not.toBeInTheDocument());
    expect(failed.getAllByRole('listitem')).toHaveLength(1);
    expect(count('GET', '/api/activity')).toBe(2);
  });

  it('keeps the task and reports the error when the retry fails', async () => {
    const { user } = setup(() => ({ ...EMPTY, failedTasks: TASKS }), {
      'POST /api/activity/tasks/6/retry': () => new Response(JSON.stringify({ error: 'The task no longer exists.' }), { status: 404 }),
    });
    const failed = await region('Failed work');
    const items = await failed.findAllByRole('listitem');
    await user.click(within(items[1]!).getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText(/The task no longer exists/)).toBeInTheDocument();
    expect(failed.getAllByRole('listitem')).toHaveLength(2);
  });

  it('lists sent and failed notifications', async () => {
    setup(() => ({
      ...EMPTY,
      notifications: [
        { id: 1, count: 1, state: 'sent', error: null, createdAt: '2026-11-10T09:00:00Z' },
        { id: 2, count: 3, state: 'failed', error: 'ntfy answered 500.', createdAt: '2026-11-10T10:00:00Z' },
      ],
    }));
    const items = await (await region('Notifications')).findAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent('Sent');
    expect(items[0]).toHaveTextContent('1 posting');
    expect(items[1]).toHaveTextContent('Failed');
    expect(items[1]).toHaveTextContent('3 postings');
    expect(items[1]).toHaveTextContent('ntfy answered 500.');
  });

  it('shows the log with the level of each entry and filters by level', async () => {
    const { user, logLevels, count } = setup(() => EMPTY);
    const log = await region('Log');
    const entries = await log.findAllByRole('listitem');
    expect(entries).toHaveLength(3);
    expect(entries[0]).toHaveTextContent('INFO');
    expect(entries[0]).toHaveTextContent('Fetch run 2 started.');
    expect(entries[1]).toHaveTextContent('WARN');
    expect(entries[2]).toHaveTextContent('ERROR');
    expect(entries[2]).toHaveTextContent('LinkedIn failed with status 429.');
    // "All" sends no level.
    expect(logLevels).toEqual([null]);

    await user.selectOptions(log.getByLabelText('Level'), 'error');
    await waitFor(() => expect(log.getAllByRole('listitem')).toHaveLength(1));
    expect(log.getByText('LinkedIn failed with status 429.')).toBeInTheDocument();
    expect(log.queryByText('Fetch run 2 started.')).not.toBeInTheDocument();
    expect(logLevels).toEqual([null, 'error']);

    await user.click(log.getByRole('button', { name: 'Refresh' }));
    await waitFor(() => expect(count('GET', '/api/logs')).toBe(3));
    expect(logLevels).toEqual([null, 'error', 'error']);
  });

  it('says so when the log is empty', async () => {
    setup(() => EMPTY, { 'GET /api/logs': () => [] });
    expect(await (await region('Log')).findByText('No log entries.')).toBeInTheDocument();
  });

  it('shows the error and loads again on request when the activity cannot be loaded', async () => {
    let fail = true;
    const { user } = setup(() => ({ ...EMPTY, runs: RUNS }), {
      'GET /api/activity': () => (fail ? new Response(JSON.stringify({ error: 'Database is locked.' }), { status: 500 }) : { ...EMPTY, runs: RUNS }),
    });
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Database is locked.');
    // The log has its own request and still shows.
    expect(await (await region('Log')).findAllByRole('listitem')).toHaveLength(3);

    fail = false;
    await user.click(within(alert).getByRole('button', { name: 'Try again' }));
    expect(await (await region('Fetch runs')).findAllByRole('table')).toHaveLength(2);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

describe('activity header and runs by width', () => {
  beforeEach(() => resetToastsForTests());
  afterEach(() => {
    vi.unstubAllGlobals();
    resetToastsForTests();
  });

  /** The header of the page: the title and its buttons. */
  const header = async () => within((await screen.findByRole('heading', { level: 1, name: 'Activity' })).parentElement!);

  for (const device of [
    { name: 'at 430px on a touch screen', coarse: true, width: 430 },
    { name: 'at 1440px with a mouse', coarse: false, width: 1440 },
  ]) {
    it(`starts a fetch run and pauses matching from the header ${device.name}`, async () => {
      mockMedia({ coarse: device.coarse, width: device.width });
      const { user, count } = setup(() => EMPTY, {
        'POST /api/fetch': () => ({ started: true, runId: 9 }),
        'POST /api/matching/pause': () => ({ paused: true }),
      });
      const h = await header();
      expect(document.title).toBe('Activity · sieve');
      await user.click(await h.findByRole('button', { name: 'Fetch now' }));
      await waitFor(() => expect(count('POST', '/api/fetch')).toBe(1));
      expect(await screen.findByText('Fetch run started.')).toBeInTheDocument();

      await user.click(h.getByRole('button', { name: 'Pause matching' }));
      await waitFor(() => expect(count('POST', '/api/matching/pause')).toBe(1));
      expect(await h.findByRole('button', { name: 'Resume matching' })).toBeInTheDocument();
    });
  }

  it('resumes matching while it is paused, and offers no fetch while a run is active', async () => {
    const { user, count } = setup(
      () => EMPTY,
      { 'POST /api/matching/resume': () => ({ paused: false }), 'GET /api/runs': () => [] },
      {
        ...STATUS,
        matchingPaused: true,
        activeRunId: 3,
      },
    );
    const h = await header();
    expect(await h.findByRole('button', { name: 'Fetch now' })).toBeDisabled();
    await user.click(h.getByRole('button', { name: 'Resume matching' }));
    await waitFor(() => expect(count('POST', '/api/matching/resume')).toBe(1));
    expect(await h.findByRole('button', { name: 'Pause matching' })).toBeInTheDocument();
  });

  it('shows each source of a run in two lines at 430px: the source and its state, then the counts', async () => {
    mockMedia({ coarse: true, width: 430 });
    setup(() => ({ ...EMPTY, runs: RUNS }));
    const runs = await region('Fetch runs');
    await runs.findByText('Jobindex');
    expect(runs.queryByRole('table')).not.toBeInTheDocument();

    const row = (source: string) => runs.getByText(source).closest('li') as HTMLElement;
    const lines = (source: string) => [...row(source).querySelectorAll('p')].map((p) => p.textContent);
    expect(lines('Jobindex')).toEqual(['JobindexCompleted', '41 found · 7 new · 2 invalid']);
    expect(lines('LinkedIn')).toEqual(['LinkedInFailed', '0 found · 0 new · 0 invalid', 'The site answered 429.']);
    expect(lines('Remote OK')).toEqual(['Remote OKRunning', '13 found · 4 new · 0 invalid']);
  });
});
