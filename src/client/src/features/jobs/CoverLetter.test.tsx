import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { CoverLetterDto, PostingDetail } from '../../../../shared/api';
import { api } from '../../api/endpoints';
import { qk } from '../../api/keys';
import { makeItem, mockApi } from '../../test-utils';
import { Toaster, resetToastsForTests } from '../../lib/toast';
import { CoverLetter } from './CoverLetter';

const ID = 'p1';
const LETTER_PATH = `/api/postings/${ID}/cover-letter`;
const TEXT = 'Dear Acme, I build reliable web applications and want to do that for you.';

function letter(extra: Partial<CoverLetterDto> = {}): CoverLetterDto {
  return {
    postingId: ID,
    state: 'ready',
    text: TEXT,
    language: 'English',
    instruction: null,
    error: null,
    model: 'm',
    edited: false,
    generatedAt: '2026-11-10T08:00:00Z',
    updatedAt: '2026-11-10T08:00:00Z',
    ...extra,
  };
}

function detail(coverLetter: CoverLetterDto | null): PostingDetail {
  return { ...makeItem(ID, 80), description: 'Build things.', facts: null, sourceLinks: [], application: null, match: null, coverLetter, matchAnalysis: null };
}

/** The component as the detail panel uses it: the letter comes from the posting query. */
function Harness() {
  const posting = useQuery({ queryKey: qk.posting(ID), queryFn: () => api.posting(ID) });
  if (!posting.data) return null;
  return (
    <>
      <CoverLetter postingId={ID} letter={posting.data.coverLetter} />
      <Toaster />
    </>
  );
}

/** Starts the mock server with one posting. `server.letter` is the stored letter, which a test can change. */
function setup(initial: CoverLetterDto | null, routes: Parameters<typeof mockApi>[0] = {}) {
  const server = { letter: initial };
  const apiMock = mockApi({ [`GET /api/postings/${ID}`]: () => detail(server.letter), ...routes });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const user = userEvent.setup();
  render(
    <QueryClientProvider client={queryClient}>
      <Harness />
    </QueryClientProvider>,
  );
  const posts = () => apiMock.calls.filter((c) => c.method === 'POST' && c.path === LETTER_PATH);
  const puts = () => apiMock.calls.filter((c) => c.method === 'PUT' && c.path === LETTER_PATH);
  return { server, api: apiMock, queryClient, user, posts, puts };
}

const instructionField = () => screen.findByLabelText(/Instruction for this letter/);

describe('cover letter', () => {
  beforeEach(() => resetToastsForTests());
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    resetToastsForTests();
  });

  it('offers to generate when no letter exists and sends the instruction', async () => {
    const { user, posts } = setup(null, {
      [`POST ${LETTER_PATH}`]: (c) => letter({ state: 'pending', text: null, instruction: (c.body as { instruction: string }).instruction }),
    });
    const field = await instructionField();
    expect(field).toBeVisible();
    expect(screen.queryByLabelText('Cover letter text')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Download PDF' })).not.toBeInTheDocument();

    await user.type(field, '  mention my open source work ');
    await user.click(screen.getByRole('button', { name: 'Generate cover letter' }));

    await waitFor(() => expect(posts()).toHaveLength(1));
    expect(posts()[0]!.body).toEqual({ instruction: 'mention my open source work' });
    // The server answers with a pending letter, so the progress message appears.
    expect(await screen.findByText(/This takes up to a minute/)).toBeInTheDocument();
  });

  it('sends a null instruction when the field is empty', async () => {
    const { user, posts } = setup(null, { [`POST ${LETTER_PATH}`]: () => letter({ state: 'pending', text: null }) });
    await instructionField();
    await user.click(screen.getByRole('button', { name: 'Generate cover letter' }));
    await waitFor(() => expect(posts()).toHaveLength(1));
    expect(posts()[0]!.body).toEqual({ instruction: null });
  });

  it('shows progress and locks the controls while the letter is pending, then shows the finished text', async () => {
    const { server, queryClient, posts } = setup(letter({ state: 'pending', text: null, instruction: 'at most 200 words' }));
    expect(await screen.findByText(/This takes up to a minute/)).toBeInTheDocument();
    expect(screen.getAllByRole('status').length).toBeGreaterThan(0);
    expect(await instructionField()).toBeDisabled();
    expect(await instructionField()).toHaveValue('at most 200 words');
    expect(screen.getByRole('button', { name: 'Generate cover letter' })).toBeDisabled();
    expect(screen.queryByLabelText('Cover letter text')).not.toBeInTheDocument();

    // The server finishes and the posting query reloads, as it does after the live event.
    server.letter = letter();
    await act(() => queryClient.invalidateQueries({ queryKey: qk.posting(ID) }));
    expect(await screen.findByLabelText('Cover letter text')).toHaveValue(TEXT);
    expect(screen.queryByText(/This takes up to a minute/)).not.toBeInTheDocument();
    expect(posts()).toHaveLength(0);
  });

  it('shows a ready letter, and saves an edit with PUT', async () => {
    const { user, puts } = setup(letter(), {
      [`PUT ${LETTER_PATH}`]: (c) => letter({ text: (c.body as { text: string }).text, edited: true, updatedAt: '2026-11-11T08:00:00Z' }),
    });
    const text = await screen.findByLabelText('Cover letter text');
    expect(text).toHaveValue(TEXT);
    expect(screen.getByText(/English\./)).toHaveTextContent(`${TEXT.split(' ').length} words.`);
    const save = screen.getByRole('button', { name: 'Save changes' });
    expect(save).toBeDisabled();
    expect(screen.queryByText(/Edited by you/)).not.toBeInTheDocument();

    await user.clear(text);
    // An empty letter cannot be saved.
    expect(save).toBeDisabled();
    await user.type(text, 'A shorter letter.');
    expect(screen.getByText(/You have changes that are not saved\./)).toBeInTheDocument();
    // The PDF comes from the stored text, so the download waits for the save.
    expect(screen.queryByRole('link', { name: 'Download PDF' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Download PDF' })).toBeDisabled();

    expect(save).toBeEnabled();
    await user.click(save);
    await waitFor(() => expect(puts()).toHaveLength(1));
    expect(puts()[0]!.body).toEqual({ text: 'A shorter letter.' });

    expect(await screen.findByText('Cover letter saved.')).toBeInTheDocument();
    expect(await screen.findByText(/Edited by you\./)).toBeInTheDocument();
    expect(screen.getByLabelText('Cover letter text')).toHaveValue('A shorter letter.');
    expect(screen.queryByText(/You have changes that are not saved\./)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled();
    expect(screen.getByRole('link', { name: 'Download PDF' })).toBeInTheDocument();
  });

  it('keeps the edit and reports the error when the save fails', async () => {
    const { user } = setup(letter(), {
      [`PUT ${LETTER_PATH}`]: () => new Response(JSON.stringify({ error: 'Database is locked.' }), { status: 500 }),
    });
    const text = await screen.findByLabelText('Cover letter text');
    await user.type(text, ' More.');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText(/Database is locked/)).toBeInTheDocument();
    expect(text).toHaveValue(`${TEXT} More.`);
    expect(screen.getByText(/You have changes that are not saved\./)).toBeInTheDocument();
  });

  it('copies the text, including an edit that is not saved', async () => {
    const { user } = setup(letter());
    const text = await screen.findByLabelText('Cover letter text');
    await user.click(screen.getByRole('button', { name: 'Copy' }));
    expect(await screen.findByText('Cover letter copied.')).toBeInTheDocument();
    expect(await navigator.clipboard.readText()).toBe(TEXT);

    await user.type(text, ' PS.');
    await user.click(screen.getByRole('button', { name: 'Copy' }));
    await waitFor(async () => expect(await navigator.clipboard.readText()).toBe(`${TEXT} PS.`));
  });

  it('reports when the browser refuses the copy', async () => {
    const { user } = setup(letter());
    await screen.findByLabelText('Cover letter text');
    vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(new Error('denied'));
    await user.click(screen.getByRole('button', { name: 'Copy' }));
    expect(await screen.findByText(/The browser did not allow the copy/)).toBeInTheDocument();
  });

  it('links to the PDF of the letter', async () => {
    setup(letter());
    const link = await screen.findByRole('link', { name: 'Download PDF' });
    expect(link).toHaveAttribute('href', `/api/postings/${ID}/cover-letter.pdf`);
    expect(link).toHaveAttribute('download');
  });

  it('shows the error of a failed letter and generates again on retry', async () => {
    const { user, posts } = setup(letter({ state: 'failed', text: null, error: 'The claude command timed out.' }), {
      [`POST ${LETTER_PATH}`]: () => letter(),
    });
    const alert = await screen.findByRole('alert');
    // A plain sentence first, and the technical error below it in small muted text.
    expect(alert.firstElementChild).toHaveTextContent(/^The letter could not be written\. Try again\.$/);
    expect(within(alert).getByText('The claude command timed out.')).toHaveClass('text-xs', 'text-muted');
    expect(screen.queryByLabelText('Cover letter text')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Generate cover letter' }));
    await waitFor(() => expect(posts()).toHaveLength(1));
    expect(await screen.findByLabelText('Cover letter text')).toHaveValue(TEXT);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('keeps the earlier text when a later generation failed', async () => {
    setup(letter({ error: 'The model is not available.' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('The last generation failed. The earlier letter is kept.');
    expect(alert).toHaveTextContent('The model is not available.');
    expect(screen.getByLabelText('Cover letter text')).toHaveValue(TEXT);
  });

  it('reports the error when the server rejects the generation', async () => {
    const { user } = setup(null, {
      [`POST ${LETTER_PATH}`]: () => new Response(JSON.stringify({ error: 'Import a CV first. The letter is written from your CV.' }), { status: 400 }),
    });
    await instructionField();
    await user.click(screen.getByRole('button', { name: 'Generate cover letter' }));
    expect(await screen.findByText(/Import a CV first/)).toBeInTheDocument();
    // The control is usable again.
    expect(screen.getByRole('button', { name: 'Generate cover letter' })).toBeEnabled();
  });

  it('asks for confirmation before it replaces a letter', async () => {
    const { user, posts } = setup(letter({ instruction: 'be brief' }), {
      [`POST ${LETTER_PATH}`]: (c) => letter({ state: 'pending', instruction: (c.body as { instruction: string }).instruction }),
    });
    await screen.findByLabelText('Cover letter text');
    await user.click(screen.getByText('Write a new letter'));
    expect(screen.queryByRole('button', { name: 'Generate cover letter' })).not.toBeInTheDocument();

    await user.click(await screen.findByRole('button', { name: 'Regenerate' }));
    expect(posts()).toHaveLength(0);
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(posts()).toHaveLength(0);
    expect(screen.queryByRole('button', { name: 'Replace the current letter' })).not.toBeInTheDocument();

    const field = await instructionField();
    expect(field).toHaveValue('be brief');
    await user.clear(field);
    await user.type(field, 'mention the team');
    await user.click(screen.getByRole('button', { name: 'Regenerate' }));
    expect(posts()).toHaveLength(0);
    await user.click(screen.getByRole('button', { name: 'Replace the current letter' }));

    await waitFor(() => expect(posts()).toHaveLength(1));
    expect(posts()[0]!.body).toEqual({ instruction: 'mention the team' });
    // The earlier text stays visible, locked, while the new letter is written.
    expect(await screen.findByText(/This takes up to a minute/)).toBeInTheDocument();
    expect(screen.getByLabelText('Cover letter text')).toBeDisabled();
    expect(screen.getByLabelText('Cover letter text')).toHaveValue(TEXT);
  });
});

describe('cover letter field', () => {
  beforeEach(() => resetToastsForTests());
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    resetToastsForTests();
  });

  it('grows with its text on load and on input, so only the panel scrolls', async () => {
    // jsdom has no layout. The scroll height here follows the length of the text.
    vi.spyOn(HTMLTextAreaElement.prototype, 'scrollHeight', 'get').mockImplementation(function (this: HTMLTextAreaElement) {
      return 100 + this.value.length;
    });
    const { user } = setup(letter());
    const field = await screen.findByLabelText('Cover letter text');
    expect(field).toHaveClass('field-sizing-content', 'overflow-hidden', 'resize-none');
    expect(field.style.height).toBe(`${100 + TEXT.length}px`);

    await user.type(field, ' More.');
    expect(field.style.height).toBe(`${100 + TEXT.length + 6}px`);
  });
});
