import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ApplicationDto } from '../../../../shared/api';
import { STATUS, mockApi, renderApp } from '../../test-utils';
import { resetToastsForTests } from '../../lib/toast';
import { resetNotesDraftsForTests } from './notes';

function app(id: string, stage: ApplicationDto['stage']): ApplicationDto {
  return {
    postingId: id,
    stage,
    notes: null,
    interviewAt: null,
    appliedAt: '2026-11-01T10:00:00Z',
    updatedAt: '2026-11-01T10:00:00Z',
    snapshot: { title: `Role ${id}`, company: 'Acme', location: null, url: 'https://x', description: 'Stored text.', facts: null },
    linkStatus: 'active',
    totalScore: 80,
  };
}

function column(name: string): HTMLElement {
  return screen.getByRole('region', { name: new RegExp(`^${name},`) });
}

const base = {
  'GET /api/auth/me': () => ({ authRequired: false, authenticated: true }),
  'GET /api/status': () => STATUS,
};

describe('application board', () => {
  afterEach(async () => {
    // The panel stores open notes as it unmounts, so it unmounts while the mocked server still answers.
    cleanup();
    await new Promise((r) => setTimeout(r, 0));
    vi.unstubAllGlobals();
    resetToastsForTests();
    resetNotesDraftsForTests();
  });

  it('moves a card with the stage menu and with a drop', async () => {
    // The mock server stores the stage, so a reload of the list shows what the server holds.
    let stored: ApplicationDto['stage'] = 'applied';
    const api = mockApi({
      ...base,
      'GET /api/applications': () => [app('1', stored)],
      'PATCH /api/applications/1': (c) => {
        stored = (c.body as { stage: ApplicationDto['stage'] }).stage;
        return app('1', stored);
      },
    });
    const patches = () => api.calls.filter((c) => c.method === 'PATCH' && c.path === '/api/applications/1');
    const user = userEvent.setup();
    const { unmount } = renderApp('/board');
    await screen.findByText('Role 1');
    await user.selectOptions(screen.getByLabelText('Stage of Role 1'), 'interview');
    await waitFor(() => expect(within(column('Interview')).getByText('Role 1')).toBeInTheDocument());
    expect(api.calls.find((c) => c.method === 'PATCH')?.body).toEqual({ stage: 'interview' });

    const data = { getData: () => '1', setData: () => {}, dropEffect: 'move', effectAllowed: 'move' };
    fireEvent.drop(column('Offer'), { dataTransfer: data });
    await waitFor(() => expect(within(column('Offer')).getByText('Role 1')).toBeInTheDocument());
    await waitFor(() => expect(patches()).toHaveLength(2));
    expect(patches()[1]!.body).toEqual({ stage: 'offer' });

    // A reload: the page starts again and reads the applications from the server.
    unmount();
    const lists = () => api.calls.filter((c) => c.method === 'GET' && c.path === '/api/applications').length;
    const before = lists();
    renderApp('/board');
    await screen.findByText('Role 1');
    expect(lists()).toBe(before + 1);
    expect(within(column('Offer')).getByText('Role 1')).toBeInTheDocument();
    expect(within(column('Applied')).queryByText('Role 1')).not.toBeInTheDocument();
    expect(within(column('Interview')).queryByText('Role 1')).not.toBeInTheDocument();
  });

  it('shows the interview date on the card', async () => {
    const interviewAt = new Date(Date.now() + 30 * 86_400_000).toISOString();
    mockApi({
      ...base,
      'GET /api/applications': () => [{ ...app('1', 'interview'), interviewAt }, app('2', 'interview')],
    });
    renderApp('/board');
    const title = await screen.findByText('Role 1');
    const cards = within(column('Interview')).getAllByRole('listitem');
    expect(cards).toHaveLength(2);
    const card = cards.find((c) => c.contains(title))!;
    const date = new Date(interviewAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }).replace(/\s+/g, ' ');
    expect(within(card).getByText(`Interview ${date}`)).toBeInTheDocument();
    expect(within(card).queryByText(/Interview was/)).not.toBeInTheDocument();
    // A card without an interview date shows none.
    const other = cards.find((c) => !c.contains(title))!;
    expect(within(other).getByText('Role 2')).toBeInTheDocument();
    expect(within(other).queryByText(/^Interview (was )?\S/)).not.toBeInTheDocument();
  });

  it('sets an interview date in the panel and shows it on the card', async () => {
    let stored = app('1', 'interview');
    const api = mockApi({
      ...base,
      'GET /api/applications': () => [stored],
      'GET /api/applications/1/events': () => [],
      'PATCH /api/applications/1': (c) => {
        stored = { ...stored, ...(c.body as Partial<ApplicationDto>) };
        return stored;
      },
    });
    renderApp('/board?app=1');
    const panel = await screen.findByRole('complementary', { name: 'Application details' });
    const when = new Date(Date.now() + 14 * 86_400_000);
    when.setHours(10, 30, 0, 0);
    const pad = (n: number) => String(n).padStart(2, '0');
    const local = `${when.getFullYear()}-${pad(when.getMonth() + 1)}-${pad(when.getDate())}T10:30`;
    // The date stores as it changes, without a save button.
    expect(within(panel).queryByRole('button', { name: 'Save date' })).not.toBeInTheDocument();
    fireEvent.change(await within(panel).findByLabelText('Interview date and time'), { target: { value: local } });
    await waitFor(() => expect(api.calls.find((c) => c.method === 'PATCH')?.body).toEqual({ interviewAt: when.toISOString() }));
    expect(await within(panel).findByText('Saved')).toBeInTheDocument();
    const card = within(column('Interview')).getByRole('listitem');
    const date = when.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }).replace(/\s+/g, ' ');
    await waitFor(() => expect(within(card).getByText(`Interview ${date}`)).toBeInTheDocument());
  });

  it('removes an application from the panel after the confirmation, and the panel closes', async () => {
    let apps = [app('1', 'applied'), app('2', 'interview')];
    const api = mockApi({
      ...base,
      'GET /api/applications': () => apps,
      'GET /api/applications/1/events': () => [],
      'DELETE /api/applications/1': () => {
        apps = apps.filter((a) => a.postingId !== '1');
        return { ok: true };
      },
    });
    const user = userEvent.setup();
    renderApp('/board?app=1');
    const panel = await screen.findByRole('complementary', { name: 'Application details' });
    await user.click(await within(panel).findByRole('button', { name: 'Remove application' }));
    expect(api.calls.some((c) => c.method === 'DELETE')).toBe(false);
    await user.click(within(panel).getByRole('button', { name: 'Yes, remove it' }));
    await waitFor(() => expect(screen.queryByRole('complementary', { name: 'Application details' })).not.toBeInTheDocument());
    expect(screen.queryByText('This application does not exist.')).not.toBeInTheDocument();
    await waitFor(() => expect(within(column('Applied')).queryByRole('listitem')).not.toBeInTheDocument());
    expect(await screen.findByText('Application removed. The posting is saved in the job list.')).toBeInTheDocument();
  });

  it('stores the notes when the user leaves the field, and shows them when the application is opened again', async () => {
    let stored = app('1', 'applied');
    const api = mockApi({
      ...base,
      'GET /api/applications': () => [stored],
      'GET /api/applications/1/events': () => [],
      'PATCH /api/applications/1': (c) => {
        stored = { ...stored, ...(c.body as Partial<ApplicationDto>) };
        return stored;
      },
    });
    const user = userEvent.setup();
    const { unmount } = renderApp('/board?app=1');
    const panel = await screen.findByRole('complementary', { name: 'Application details' });
    const notes = await within(panel).findByLabelText('Notes');
    expect(notes).toHaveValue('');
    expect(within(panel).queryByRole('button', { name: 'Save notes' })).not.toBeInTheDocument();
    await user.type(notes, 'Call with Mia on Friday.');
    expect(api.calls.some((c) => c.method === 'PATCH')).toBe(false);
    await user.tab();
    await waitFor(() => expect(api.calls.find((c) => c.method === 'PATCH')?.body).toEqual({ notes: 'Call with Mia on Friday.' }));
    expect(await within(panel).findByText('Saved')).toBeInTheDocument();

    // The page starts again and the panel reads the notes from the server.
    unmount();
    renderApp('/board?app=1');
    const again = await screen.findByRole('complementary', { name: 'Application details' });
    expect(await within(again).findByLabelText('Notes')).toHaveValue('Call with Mia on Friday.');
  });

  it('says "Saving…" while the notes are stored and "Saved" after', async () => {
    let answer: (r: Response) => void = () => {};
    mockApi({
      ...base,
      'GET /api/applications': () => [app('1', 'applied')],
      'GET /api/applications/1/events': () => [],
      'PATCH /api/applications/1': () => new Promise<Response>((resolve) => (answer = resolve)),
    });
    const user = userEvent.setup();
    renderApp('/board?app=1');
    const panel = await screen.findByRole('complementary', { name: 'Application details' });
    await user.type(await within(panel).findByLabelText('Notes'), 'Ask about the team.');
    await user.tab();
    expect(await within(panel).findByText('Saving…')).toBeInTheDocument();
    answer(Response.json({ ...app('1', 'applied'), notes: 'Ask about the team.' }));
    expect(await within(panel).findByText('Saved')).toBeInTheDocument();
    expect(within(panel).queryByText('Saving…')).not.toBeInTheDocument();
    // A new change is not saved yet, so the caption goes.
    await user.type(within(panel).getByLabelText('Notes'), ' And the salary.');
    expect(within(panel).queryByText('Saved')).not.toBeInTheDocument();
  });

  it('stores the notes when the application closes while the user is still typing', async () => {
    let stored = app('1', 'applied');
    const api = mockApi({
      ...base,
      'GET /api/applications': () => [stored],
      'GET /api/applications/1/events': () => [],
      'PATCH /api/applications/1': (c) => {
        stored = { ...stored, ...(c.body as Partial<ApplicationDto>) };
        return stored;
      },
    });
    const patches = () => api.calls.filter((c) => c.method === 'PATCH');
    const user = userEvent.setup();
    const { history } = renderApp('/board?app=1');
    let panel = await screen.findByRole('complementary', { name: 'Application details' });
    const notes = await within(panel).findByLabelText('Notes');
    await user.type(notes, 'Second round next week.');
    expect(notes).toHaveFocus();
    // A tap on Close that does not move the focus out of the field first.
    fireEvent.click(within(panel).getByRole('button', { name: /Close/ }));
    await waitFor(() => expect(screen.queryByRole('complementary', { name: 'Application details' })).not.toBeInTheDocument());
    await waitFor(() => expect(patches()).toHaveLength(1));
    expect(patches()[0]!.body).toEqual({ notes: 'Second round next week.' });

    // The back gesture leaves the panel without Close: the unmount stores the notes.
    act(() => history.push('/board?app=1'));
    panel = await screen.findByRole('complementary', { name: 'Application details' });
    expect(within(panel).getByLabelText('Notes')).toHaveValue('Second round next week.');
    await user.type(within(panel).getByLabelText('Notes'), ' Bring the portfolio.');
    act(() => history.push('/board'));
    await waitFor(() => expect(patches()).toHaveLength(2));
    expect(patches()[1]!.body).toEqual({ notes: 'Second round next week. Bring the portfolio.' });
  });

  it('stores the notes when the page is hidden or left', async () => {
    let stored = app('1', 'applied');
    const api = mockApi({
      ...base,
      'GET /api/applications': () => [stored],
      'GET /api/applications/1/events': () => [],
      'PATCH /api/applications/1': (c) => {
        stored = { ...stored, ...(c.body as Partial<ApplicationDto>) };
        return stored;
      },
    });
    const patches = () => api.calls.filter((c) => c.method === 'PATCH');
    const user = userEvent.setup();
    renderApp('/board?app=1');
    const panel = await screen.findByRole('complementary', { name: 'Application details' });
    const notes = await within(panel).findByLabelText('Notes');
    await user.type(notes, 'Draft one.');
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    act(() => void document.dispatchEvent(new Event('visibilitychange')));
    visibility.mockRestore();
    await waitFor(() => expect(patches()).toHaveLength(1));
    expect(patches()[0]!.body).toEqual({ notes: 'Draft one.' });

    await user.type(notes, ' Draft two.');
    act(() => void window.dispatchEvent(new Event('pagehide')));
    await waitFor(() => expect(patches()).toHaveLength(2));
    expect(patches()[1]!.body).toEqual({ notes: 'Draft one. Draft two.' });
  });

  it('sends no request when the application closes with unchanged notes', async () => {
    const api = mockApi({
      ...base,
      'GET /api/applications': () => [{ ...app('1', 'applied'), notes: 'Kept as is.' }],
      'GET /api/applications/1/events': () => [],
    });
    const user = userEvent.setup();
    const { history } = renderApp('/board?app=1');
    const panel = await screen.findByRole('complementary', { name: 'Application details' });
    const notes = await within(panel).findByLabelText('Notes');
    await user.click(notes);
    await user.tab();
    // A text typed and taken back is unchanged too.
    await user.type(notes, 'x');
    await user.keyboard('{Backspace}');
    await user.click(within(panel).getByRole('button', { name: /Close/ }));
    await waitFor(() => expect(screen.queryByRole('complementary', { name: 'Application details' })).not.toBeInTheDocument());
    act(() => void window.dispatchEvent(new Event('pagehide')));
    act(() => history.push('/jobs'));
    await new Promise((r) => setTimeout(r, 20));
    expect(api.calls.filter((c) => c.method === 'PATCH')).toEqual([]);
  });

  it('reports a failed store of the notes and shows the typed notes when the application opens again', async () => {
    let stored = app('1', 'applied');
    let failing = true;
    const api = mockApi({
      ...base,
      'GET /api/applications': () => [stored],
      'GET /api/applications/1/events': () => [],
      'PATCH /api/applications/1': (c) => {
        if (failing) return new Response(JSON.stringify({ error: 'Disk full.' }), { status: 500 });
        stored = { ...stored, ...(c.body as Partial<ApplicationDto>) };
        return stored;
      },
    });
    const patches = () => api.calls.filter((c) => c.method === 'PATCH');
    const user = userEvent.setup();
    const { history, unmount } = renderApp('/board?app=1');
    let panel = await screen.findByRole('complementary', { name: 'Application details' });
    await user.type(await within(panel).findByLabelText('Notes'), 'Offer expected in May.');
    await user.tab();
    const error = await screen.findByRole('alert');
    expect(error).toHaveTextContent('The notes were not saved.');
    expect(error).toHaveTextContent('Disk full.');
    expect(within(panel).queryByText('Saved')).not.toBeInTheDocument();

    // Closed and opened again: the typed notes come back, not the stored empty ones.
    await user.click(within(panel).getByRole('button', { name: /Close/ }));
    await waitFor(() => expect(screen.queryByRole('complementary', { name: 'Application details' })).not.toBeInTheDocument());
    act(() => history.push('/board?app=1'));
    panel = await screen.findByRole('complementary', { name: 'Application details' });
    expect(within(panel).getByLabelText('Notes')).toHaveValue('Offer expected in May.');

    // The next chance stores them, and the draft goes once the store succeeds.
    failing = false;
    const before = patches().length;
    await user.click(within(panel).getByLabelText('Notes'));
    await user.tab();
    await waitFor(() => expect(patches()).toHaveLength(before + 1));
    expect(patches().at(-1)!.body).toEqual({ notes: 'Offer expected in May.' });
    expect(await within(panel).findByText('Saved')).toBeInTheDocument();
    unmount();
    stored = { ...stored, notes: 'Changed on another device.' };
    renderApp('/board?app=1');
    const again = await screen.findByRole('complementary', { name: 'Application details' });
    expect(await within(again).findByLabelText('Notes')).toHaveValue('Changed on another device.');
  });

  it('shows the stage history of an application in time order', async () => {
    mockApi({
      ...base,
      'GET /api/applications': () => [app('1', 'offer')],
      'GET /api/applications/1/events': () => [
        { id: 1, fromStage: null, toStage: 'applied', createdAt: '2026-11-01T10:00:00Z' },
        { id: 2, fromStage: 'applied', toStage: 'interview', createdAt: '2026-11-05T09:00:00Z' },
        { id: 3, fromStage: 'interview', toStage: 'offer', createdAt: '2026-11-12T15:00:00Z' },
      ],
    });
    renderApp('/board?app=1');
    const panel = await screen.findByRole('complementary', { name: 'Application details' });
    const heading = await within(panel).findByRole('heading', { name: 'Stage history' });
    const history = heading.parentElement!;
    const items = await within(history).findAllByRole('listitem');
    const at = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
    expect(items.map((li) => li.textContent?.replace(/\s+/g, ' '))).toEqual(
      [
        `${at('2026-11-01T10:00:00Z')}Created in Applied`,
        `${at('2026-11-05T09:00:00Z')}Applied to Interview`,
        `${at('2026-11-12T15:00:00Z')}Interview to Offer`,
      ].map((t) => t.replace(/\s+/g, ' ')),
    );
  });

  it('returns the card to its column and reports the error when the move fails', async () => {
    mockApi({
      ...base,
      'GET /api/applications': () => [app('1', 'applied')],
      'PATCH /api/applications/1': () => new Response(JSON.stringify({ error: 'Disk full.' }), { status: 500 }),
    });
    const user = userEvent.setup();
    renderApp('/board');
    await screen.findByText('Role 1');
    await user.selectOptions(screen.getByLabelText('Stage of Role 1'), 'offer');
    expect(await screen.findByText(/Disk full/)).toBeInTheDocument();
    await waitFor(() => expect(within(column('Applied')).getByText('Role 1')).toBeInTheDocument());
  });
});
