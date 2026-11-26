import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import type { MatchSummary, PostingListItem } from '../../../../shared/api';
import { STATUS, makeItem, mockApi, renderApp } from '../../test-utils';
import { resetToastsForTests } from '../../lib/toast';

const COUNT = 2000;

function match(state: MatchSummary['state'], totalScore: number | null, extra: Partial<MatchSummary> = {}): MatchSummary {
  return { state, totalScore, stale: false, excludedReason: null, ...extra };
}

/** 2000 postings. The first ones cover each score band and each state without a score. */
function makePostings(): PostingListItem[] {
  const special: Record<number, Partial<PostingListItem>> = {
    2: { match: match('scored', 62) },
    3: { match: match('scored', 31) },
    4: { match: null },
    5: { match: match('in_progress', null) },
    6: { match: match('failed', null) },
    7: { match: match('excluded', null, { excludedReason: 'Requires Danish' }) },
    8: { match: match('in_progress', 77) },
    9: { match: match('excluded', 20, { excludedReason: 'On site only' }) },
  };
  return Array.from({ length: COUNT }, (_, i) => makeItem(String(i + 1), i === 0 ? 90 : 60, special[i + 1]));
}

function setup(items: PostingListItem[]) {
  return mockApi({
    'GET /api/auth/me': () => ({ authRequired: false, authenticated: true }),
    'GET /api/status': () => STATUS,
    'GET /api/sources': () => [],
    'GET /api/postings': () => ({ items, total: items.length, nextOffset: null }),
  });
}

const list = () => screen.getByRole('list', { name: /Job postings/ });
const cards = () => within(list()).getAllByRole('listitem');

/** The card that holds this exact title. */
function cardOf(title: string): HTMLElement {
  const card = cards().find((c) => within(c).queryByText(title));
  if (!card) throw new Error(`No card with the title "${title}".`);
  return card;
}

describe('jobs list with 2000 postings', () => {
  beforeEach(() => resetToastsForTests());
  afterEach(() => {
    vi.unstubAllGlobals();
    resetToastsForTests();
  });

  it('renders only the cards near the viewport', async () => {
    const api = setup(makePostings());
    renderApp('/jobs');
    await screen.findByText('Job 1');

    // The whole result is loaded and counted, but only a window of it is in the document.
    expect(list()).toHaveAccessibleName('Job postings, 2000 postings');
    expect(api.calls.filter((c) => c.path === '/api/postings')).toHaveLength(1);
    const count = cards().length;
    expect(count).toBeGreaterThan(0);
    expect(count).toBeLessThan(100);
    expect(screen.queryByText('Job 1000')).not.toBeInTheDocument();
    expect(screen.queryByText(`Job ${COUNT}`)).not.toBeInTheDocument();
  });

  it('replaces the cards when the list scrolls', async () => {
    setup(makePostings());
    renderApp('/jobs');
    await screen.findByText('Job 1');
    const before = cards().length;

    // The test setup gives the list a height of 600 px. Scroll far down, into the middle of the result.
    const el = list();
    el.scrollTop = 95_000;
    fireEvent.scroll(el);

    await waitFor(() => expect(screen.queryByText('Job 1')).not.toBeInTheDocument());
    const numbers = cards().map((c) => Number(/Job (\d+)/.exec(c.textContent ?? '')?.[1]));
    expect(numbers.length).toBeGreaterThan(0);
    expect(numbers.length).toBeLessThan(100);
    expect(Math.abs(numbers.length - before)).toBeLessThan(before);
    for (const n of numbers) {
      expect(n).toBeGreaterThan(500);
      expect(n).toBeLessThan(1500);
    }
  });

  it('loads the next page when the list scrolls to its end', async () => {
    const all = Array.from({ length: 80 }, (_, i) => makeItem(String(i + 1), 60));
    const offsets: Array<string | null> = [];
    const api = mockApi({
      'GET /api/auth/me': () => ({ authRequired: false, authenticated: true }),
      'GET /api/status': () => STATUS,
      'GET /api/sources': () => [],
      'GET /api/postings': (_c, url) => {
        offsets.push(url.searchParams.get('offset'));
        const offset = Number(url.searchParams.get('offset') ?? 0);
        const items = all.slice(offset, offset + 50);
        return { items, total: all.length, nextOffset: offset + items.length < all.length ? offset + items.length : null };
      },
    });
    renderApp('/jobs');
    await screen.findByText('Job 1');
    expect(list()).toHaveAccessibleName('Job postings, 80 postings');
    // The first page is loaded. Its end is not in view, so nothing else is requested.
    await waitFor(() => expect(list()).not.toHaveAttribute('aria-busy'));
    expect(offsets).toEqual(['0']);
    expect(screen.queryByText('Job 50')).not.toBeInTheDocument();
    expect(screen.queryByText('Job 51')).not.toBeInTheDocument();

    const el = list();
    // 50 cards in two columns are 25 rows of 190 px. The list is 600 px high, so this is the end of the first page.
    el.scrollTop = 25 * 190 - 600;
    fireEvent.scroll(el);

    await waitFor(() => expect(offsets).toEqual(['0', '50']));
    // The rows of the second page render after the rows of the first page.
    expect(await screen.findByText('Job 51')).toBeInTheDocument();
    expect(screen.getByText('Job 50')).toBeInTheDocument();
    // The second page is the last one, so no further request follows.
    await waitFor(() => expect(list()).not.toHaveAttribute('aria-busy'));
    expect(api.calls.filter((c) => c.path === '/api/postings')).toHaveLength(2);
    // The list stays responsive: it renders only the cards near the viewport, not every loaded posting.
    expect(cards().length).toBeGreaterThan(0);
    expect(cards().length).toBeLessThan(all.length);
    expect(screen.queryByText('Job 1')).not.toBeInTheDocument();
  });

  /** Scrolls into the middle of 2000 postings, opens a rendered card, and reports the list before and after. */
  async function openCardInTheMiddle() {
    const items = makePostings();
    const routes: Parameters<typeof mockApi>[0] = {
      'GET /api/auth/me': () => ({ authRequired: false, authenticated: true }),
      'GET /api/status': () => STATUS,
      'GET /api/sources': () => [],
      'GET /api/postings': () => ({ items, total: items.length, nextOffset: null }),
    };
    mockApi(routes);
    renderApp('/jobs');
    await screen.findByText('Job 1');

    const el = list();
    el.scrollTop = 95_000;
    fireEvent.scroll(el);
    await waitFor(() => expect(screen.queryByText('Job 1')).not.toBeInTheDocument());
    const titles = () => cards().map((c) => /Job \d+/.exec(c.textContent ?? '')?.[0]);
    const before = titles();
    expect(before.length).toBeGreaterThan(0);

    const title = before[Math.floor(before.length / 2)]!;
    const id = title.slice(4);
    const item = items.find((i) => i.id === id)!;
    routes[`GET /api/postings/${id}`] = () => ({ ...item, description: 'Build things.', facts: null, sourceLinks: [], application: null, match: null, coverLetter: null, matchAnalysis: null });
    routes[`PATCH /api/postings/${id}`] = () => ({ previous: [] });
    fireEvent.click(within(cardOf(title)).getByRole('button', { name: new RegExp(`${title}(?!\\d)`) }));
    expect(await screen.findByRole('heading', { name: title })).toBeInTheDocument();
    return { el, before, titles, title };
  }

  it('keeps the scroll position and the rendered cards when a posting opens', async () => {
    // The test setup gives every element a width of 800 px. At that window width the detail covers the list.
    vi.stubGlobal('innerWidth', 800);
    const { el, before, titles } = await openCardInTheMiddle();
    expect(list()).toBe(el);
    expect(el.scrollTop).toBe(95_000);
    expect(titles()).toEqual(before);
  });

  it('keeps the opened posting in the list when the detail opens beside the list', async () => {
    // From 1024 px the detail opens beside the list, and the list then has fewer columns.
    // The list scrolls so that the opened posting stays in view.
    vi.stubGlobal('innerWidth', 1024);
    const { el, title, titles } = await openCardInTheMiddle();
    expect(screen.getByRole('complementary', { name: 'Posting details' })).toBeInTheDocument();
    expect(list()).toBe(el);
    await waitFor(() => expect(titles()).toContain(title));
  });

  it('shows title, company, score, and the label of the score band on a card', async () => {
    setup(makePostings());
    renderApp('/jobs');
    await screen.findByText('Job 1');

    const strong = within(cardOf('Job 1'));
    expect(strong.getByText('Job 1')).toBeInTheDocument();
    expect(strong.getByText(/^Company 1\b/)).toBeInTheDocument();
    expect(strong.getByText('90')).toBeInTheDocument();
    expect(strong.getByText('Strong match')).toBeInTheDocument();

    const possible = within(cardOf('Job 2'));
    expect(possible.getByText(/^Company 2\b/)).toBeInTheDocument();
    expect(possible.getByText('62')).toBeInTheDocument();
    expect(possible.getByText('Possible match')).toBeInTheDocument();
    expect(possible.queryByText('Strong match')).not.toBeInTheDocument();

    const weak = within(cardOf('Job 3'));
    expect(weak.getByText('31')).toBeInTheDocument();
    expect(weak.getByText('Weak match')).toBeInTheDocument();
  });

  it('shows the score as a number in the color of its band', async () => {
    setup(makePostings());
    renderApp('/jobs');
    await screen.findByText('Job 1');

    const scoreOf = (title: string, score: string) => within(cardOf(title)).getByText(score);
    // High: a filled yellow block. Medium: yellow digits in a yellow frame. Low: plain digits in a grey frame.
    expect(scoreOf('Job 1', '90')).toHaveClass('bg-field-yellow', 'text-ink');
    expect(scoreOf('Job 2', '62')).toHaveClass('text-field-yellow');
    expect(scoreOf('Job 2', '62')).not.toHaveClass('bg-field-yellow');
    expect(scoreOf('Job 3', '31')).toHaveClass('text-fg');
    expect(scoreOf('Job 3', '31')).not.toHaveClass('bg-field-yellow');
    expect(scoreOf('Job 3', '31')).not.toHaveClass('text-field-yellow');
  });

  it('marks a stale score on the card and keeps the score', async () => {
    setup([
      makeItem('1', null, { match: match('scored', 81, { stale: true }) }),
      makeItem('2', 64),
    ]);
    renderApp('/jobs');
    await screen.findByText('Job 1');

    const stale = within(cardOf('Job 1'));
    expect(stale.getByText('81')).toBeInTheDocument();
    expect(stale.getByText('Stale')).toHaveAttribute('title', 'This score comes from an older profile or preferences');
    const fresh = within(cardOf('Job 2'));
    expect(fresh.getByText('64')).toBeInTheDocument();
    expect(fresh.queryByText('Stale')).not.toBeInTheDocument();
  });

  it('shows the state of a posting that has no score', async () => {
    setup(makePostings());
    renderApp('/jobs');
    await screen.findByText('Job 1');

    const states: Array<[string, string]> = [
      ['Job 4', 'Waiting'],
      ['Job 5', 'Scoring'],
      ['Job 6', 'Failed'],
      ['Job 7', 'Excluded'],
    ];
    for (const [title, state] of states) {
      const card = within(cardOf(title));
      expect(card.getByText(state)).toBeInTheDocument();
      // No band label stands in for a score that does not exist.
      expect(card.queryByText(/match$/)).not.toBeInTheDocument();
    }
    expect(within(cardOf('Job 7')).getByText('Excluded: Requires Danish')).toBeInTheDocument();
  });

  it('shows the state beside the score while a posting is rescored or excluded', async () => {
    setup(makePostings());
    renderApp('/jobs');
    await screen.findByText('Job 1');

    const rescoring = within(cardOf('Job 8'));
    expect(rescoring.getByText('77')).toBeInTheDocument();
    expect(rescoring.getByText('Strong match')).toBeInTheDocument();
    expect(rescoring.getByText('Rescoring')).toBeInTheDocument();

    const excluded = within(cardOf('Job 9'));
    expect(excluded.getByText('20')).toBeInTheDocument();
    expect(excluded.getByText('Weak match')).toBeInTheDocument();
    expect(excluded.getByText('Excluded')).toBeInTheDocument();
    expect(excluded.getByText('Excluded: On site only')).toBeInTheDocument();
  });
});

describe('swipe feedback on a card', () => {
  afterEach(() => vi.unstubAllGlobals());

  /** Puts a finger on the card of this title and moves it sideways by each offset in turn, without lifting it. */
  function moveFinger(title: string, ...offsets: number[]) {
    const target = cardOf(title).querySelector('button[data-row-button]') as HTMLElement;
    const at = (dx: number) => ({ pointerId: 1, pointerType: 'touch', clientX: 300 + dx, clientY: 300 });
    fireEvent.pointerDown(target, at(0));
    for (const dx of offsets) fireEvent.pointerMove(target, at(dx));
  }
  const layerOf = (title: string) => cardOf(title).querySelector<HTMLElement>('[data-swipe-action]');
  const movingCard = (title: string) => cardOf(title).querySelector('button[data-row-button]')?.parentElement as HTMLElement;

  it('names the action of a release and changes its look at the threshold', async () => {
    setup([makeItem('1', 90), makeItem('2', 80, { triageStatus: 'saved' }), makeItem('3', 70, { triageStatus: 'saved' })]);
    renderApp('/jobs');
    await screen.findByText('Job 1');

    // Every element is 800px wide in tests, so the threshold is 140px.
    moveFinger('Job 1', -15, -60);
    expect(layerOf('Job 1')).toHaveTextContent('Dismiss');
    expect(layerOf('Job 1')).toHaveAttribute('data-armed', 'false');
    expect(movingCard('Job 1').style.transform).toBe('translateX(-60px)');
    moveFinger('Job 1', -200);
    expect(layerOf('Job 1')).toHaveAttribute('data-armed', 'true');
    fireEvent.pointerCancel(cardOf('Job 1').querySelector('button[data-row-button]') as HTMLElement, { pointerId: 1, pointerType: 'touch' });

    moveFinger('Job 2', 15, 200);
    expect(layerOf('Job 2')).toHaveTextContent('Mark applied');
    expect(layerOf('Job 2')).toHaveAttribute('data-armed', 'true');
    expect(layerOf('Job 2')).toHaveClass('bg-field-pink', 'text-ink');
    fireEvent.pointerCancel(cardOf('Job 2').querySelector('button[data-row-button]') as HTMLElement, { pointerId: 1, pointerType: 'touch' });

    moveFinger('Job 3', -15, -60);
    expect(layerOf('Job 3')).toHaveTextContent('Back to new');
  });

  it('names Save, and Remove application in the danger look, past the threshold', async () => {
    setup([makeItem('1', 90), makeItem('2', 80, { triageStatus: 'applied' })]);
    renderApp('/jobs?status=all');
    await screen.findByText('Job 1');

    moveFinger('Job 1', 15, 200);
    expect(layerOf('Job 1')).toHaveTextContent('Save');
    expect(layerOf('Job 1')).toHaveClass('bg-field-yellow', 'text-ink');
    fireEvent.pointerCancel(cardOf('Job 1').querySelector('button[data-row-button]') as HTMLElement, { pointerId: 1, pointerType: 'touch' });

    moveFinger('Job 2', -15, -200);
    expect(layerOf('Job 2')).toHaveTextContent('Remove application');
    expect(layerOf('Job 2')).toHaveClass('text-danger');
  });

  it('does not move a card past the end of the status line', async () => {
    setup([makeItem('1', 90, { triageStatus: 'dismissed' }), makeItem('2', 80, { triageStatus: 'applied' })]);
    renderApp('/jobs?status=all');
    await screen.findByText('Job 1');

    moveFinger('Job 1', -15, -200);
    expect(layerOf('Job 1')).toBeNull();
    expect(movingCard('Job 1').style.transform).toBe('');

    moveFinger('Job 2', 15, 200);
    expect(layerOf('Job 2')).toBeNull();
    expect(movingCard('Job 2').style.transform).toBe('');
  });
});
