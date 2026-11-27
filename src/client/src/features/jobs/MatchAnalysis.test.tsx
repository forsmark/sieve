import { beforeEach, describe, expect, it } from 'vitest';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { MatchAnalysisDto, PostingDetail } from '../../../../shared/api';
import { api } from '../../api/endpoints';
import { qk } from '../../api/keys';
import { makeItem, mockApi } from '../../test-utils';
import { Toaster, resetToastsForTests } from '../../lib/toast';
import { MatchAnalysis } from './MatchAnalysis';

const ID = 'p1';
const PATH = `/api/postings/${ID}/analysis`;

function analysis(extra: Partial<MatchAnalysisDto> = {}): MatchAnalysisDto {
  return {
    postingId: ID,
    state: 'ready',
    content: {
      verdict: 'consider',
      summary: 'You meet the main requirements.',
      strengths: [{ point: 'TypeScript', evidence: 'Eight years in the CV.' }],
      gaps: [{ point: 'Kubernetes', severity: 'blocking', mitigation: 'Nothing in the CV helps.' }],
      unknowns: ['What is the salary range?'],
      positioning: ['Lead with the logistics work.'],
    },
    error: null,
    model: 'claude-fable-5-2',
    generatedAt: '2026-11-12T08:00:00Z',
    updatedAt: '2026-11-12T08:00:00Z',
    proposedTotal: null,
    scoreApplied: false,
    ...extra,
  };
}

function Harness() {
  const posting = useQuery({ queryKey: qk.posting(ID), queryFn: () => api.posting(ID) });
  if (!posting.data) return null;
  return (
    <>
      <MatchAnalysis postingId={ID} analysis={posting.data.matchAnalysis} currentScore={64} />
      <Toaster />
    </>
  );
}

function setup(initial: MatchAnalysisDto | null, routes: Parameters<typeof mockApi>[0] = {}) {
  const detail = (): PostingDetail => ({
    ...makeItem(ID, 80),
    description: 'Build things.',
    facts: null,
    sourceLinks: [],
    application: null,
    match: null,
    coverLetter: null,
    matchAnalysis: initial,
  });
  const apiMock = mockApi({ [`GET /api/postings/${ID}`]: detail, ...routes });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <Harness />
    </QueryClientProvider>,
  );
  return { api: apiMock, user: userEvent.setup() };
}

describe('expanded match analysis', () => {
  beforeEach(() => resetToastsForTests());

  it('offers the analysis and says that the CV goes to Anthropic', async () => {
    setup(null);
    expect(await screen.findByRole('button', { name: 'Run expanded analysis' })).toBeEnabled();
    expect(screen.getByText(/Your CV text and the posting text are sent to\s+Anthropic/)).toBeInTheDocument();
  });

  it('starts the analysis and shows that the model works', async () => {
    const { api: mock, user } = setup(null, { [`POST ${PATH}`]: () => analysis({ state: 'pending', content: null, generatedAt: null, model: null }) });
    await user.click(await screen.findByRole('button', { name: 'Run expanded analysis' }));
    expect(await screen.findByText(/Fable 5.2 analyzes the match/)).toBeInTheDocument();
    expect(mock.calls.filter((c) => c.method === 'POST' && c.path === PATH)).toHaveLength(1);
  });

  it('shows the verdict, each part of the analysis, and the severity of a gap', async () => {
    setup(analysis());
    expect(await screen.findByText('Consider')).toBeInTheDocument();
    expect(screen.getByText('You meet the main requirements.')).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Strengths' })).getByText('Eight years in the CV.')).toBeInTheDocument();
    const gaps = within(screen.getByRole('region', { name: 'Gaps' }));
    expect(gaps.getByText('Blocking')).toBeInTheDocument();
    expect(gaps.getByText('Nothing in the CV helps.')).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Questions to ask' })).getByText('What is the salary range?')).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'What to emphasize' })).getByText('Lead with the logistics work.')).toBeInTheDocument();
    expect(screen.getByText(/Written 2026-11-12 by claude-fable-5-2/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Run again' })).toBeEnabled();
  });

  it('says in a plain sentence that the analysis could not be made, with the technical error below it', async () => {
    setup(analysis({ state: 'failed', content: null, error: 'The claude command timed out.' }));
    const alert = await screen.findByRole('alert');
    expect(alert.firstElementChild).toHaveTextContent(/^The analysis could not be made\. Try again\.$/);
    expect(within(alert).getByText('The claude command timed out.')).toHaveClass('text-xs', 'text-muted');
    expect(screen.getByRole('button', { name: 'Run expanded analysis' })).toBeEnabled();
  });

  it('shows the cause of a failure and keeps the earlier analysis', async () => {
    setup(analysis({ error: 'The claude command timed out.' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('The last analysis failed. The earlier analysis is kept.');
    expect(alert).toHaveTextContent('The claude command timed out.');
    expect(screen.getByText('Consider')).toBeInTheDocument();
  });

  it('removes the analysis after a confirmation', async () => {
    const { api: mock, user } = setup(analysis(), { [`DELETE ${PATH}`]: () => ({ ok: true }) });
    await user.click(await screen.findByRole('button', { name: 'Remove' }));
    await user.click(await screen.findByRole('button', { name: 'Remove the analysis' }));
    await waitFor(() => expect(screen.queryByText('Consider')).not.toBeInTheDocument());
    expect(mock.calls.filter((c) => c.method === 'DELETE' && c.path === PATH)).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Run expanded analysis' })).toBeInTheDocument();
  });

  it('hides the revised score when the analysis has none', async () => {
    setup(analysis());
    expect(await screen.findByText('Consider')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Revised score' })).not.toBeInTheDocument();
  });

  it('shows the revised score and applies it to the posting', async () => {
    const scored = (applied: boolean) =>
      analysis({
        content: { ...analysis().content!, scores: { skills: 85, experience: 80, preferences: 70 } },
        proposedTotal: 81,
        scoreApplied: applied,
      });
    let applied = false;
    const { api: mock, user } = setup(scored(false), {
      [`GET /api/postings/${ID}`]: () => ({
        ...makeItem(ID, applied ? 81 : 64),
        description: null,
        facts: null,
        sourceLinks: [],
        application: null,
        match: null,
        coverLetter: null,
        matchAnalysis: scored(applied),
      }),
      [`POST ${PATH}/apply-score`]: () => {
        applied = true;
        return scored(true);
      },
    });
    const region = within(await screen.findByRole('region', { name: 'Revised score' }));
    expect(region.getByText('Revised score: 81')).toBeInTheDocument();
    expect(region.getByText('(now 64)')).toBeInTheDocument();
    await user.click(region.getByRole('button', { name: 'Use this score' }));
    expect(await screen.findByText('The posting uses this score.')).toBeInTheDocument();
    expect(mock.calls.filter((c) => c.method === 'POST' && c.path === `${PATH}/apply-score`)).toHaveLength(1);
  });
});
