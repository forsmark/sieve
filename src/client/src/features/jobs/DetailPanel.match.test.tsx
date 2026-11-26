import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import type { PostingDetail } from '../../../../shared/api';
import { DEFAULT_PREFERENCES, type Preferences } from '../../../../shared/schemas';
import { STATUS, makeItem, mockApi, renderApp } from '../../test-utils';
import { resetToastsForTests } from '../../lib/toast';

describe('match explanation in the detail', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    resetToastsForTests();
  });

  it('shows the matched skills, the missing skills, and the assessment of a scored posting', async () => {
    const item = makeItem('7', 82);
    const detail: PostingDetail = {
      ...item,
      description: 'Build things.',
      facts: null,
      sourceLinks: [{ id: '7', source: 'jobindex', url: item.url, primary: true }],
      application: null,
      coverLetter: null,
      matchAnalysis: null,
      match: {
        state: 'scored',
        totalScore: 82,
        stale: false,
        excludedReason: null,
        failReason: null,
        skillsScore: 90,
        experienceScore: 80,
        preferenceScore: 70,
        locationScore: 60,
        matchedSkills: ['React', 'TypeScript'],
        missingSkills: ['Go'],
        assessment: 'You fit the stack. You lack Go.',
        softViolations: [],
        provider: 'local',
        model: 'm',
      },
    };
    mockApi({
      'GET /api/auth/me': () => ({ authRequired: false, authenticated: true }),
      'GET /api/status': () => STATUS,
      'GET /api/sources': () => [],
      'GET /api/postings': () => ({ items: [item], total: 1, nextOffset: null }),
      'GET /api/postings/7': () => detail,
      'PATCH /api/postings/7': () => ({ previous: [] }),
    });
    renderApp('/jobs?id=7');
    expect(await screen.findByRole('heading', { name: 'Job 7' })).toBeInTheDocument();
    const matched = within(screen.getByRole('list', { name: 'Matched skills' }));
    expect(matched.getByText('React')).toBeInTheDocument();
    expect(matched.getByText('TypeScript')).toBeInTheDocument();
    expect(within(screen.getByRole('list', { name: 'Missing skills' })).getByText('Go')).toBeInTheDocument();
    expect(screen.getByText('You fit the stack. You lack Go.')).toBeInTheDocument();
  });

  it('marks location as not counted in the score breakdown when its weight is 0', async () => {
    const item = makeItem('8', 75);
    const detail: PostingDetail = {
      ...item,
      description: 'Build things.',
      facts: null,
      sourceLinks: [{ id: '8', source: 'jobindex', url: item.url, primary: true }],
      application: null,
      coverLetter: null,
      matchAnalysis: null,
      match: {
        state: 'scored',
        totalScore: 75,
        stale: false,
        excludedReason: null,
        failReason: null,
        skillsScore: 80,
        experienceScore: 70,
        preferenceScore: 75,
        locationScore: 20,
        matchedSkills: [],
        missingSkills: [],
        assessment: 'Fine.',
        softViolations: [],
        provider: 'local',
        model: 'm',
      },
    };
    const prefs: Preferences = { ...DEFAULT_PREFERENCES, weights: { ...DEFAULT_PREFERENCES.weights, location: 0 } };
    mockApi({
      'GET /api/auth/me': () => ({ authRequired: false, authenticated: true }),
      'GET /api/status': () => STATUS,
      'GET /api/sources': () => [],
      'GET /api/preferences': () => prefs,
      'GET /api/postings': () => ({ items: [item], total: 1, nextOffset: null }),
      'GET /api/postings/8': () => detail,
      'PATCH /api/postings/8': () => ({ previous: [] }),
    });
    renderApp('/jobs?id=8');
    expect(await screen.findByRole('heading', { name: 'Job 8' })).toBeInTheDocument();
    const location = (await screen.findByText('not counted')).closest('dt');
    expect(location).toHaveTextContent(/^Location/);
    for (const name of ['Skills', 'Experience', 'Preferences']) {
      const row = screen.getByText(name, { selector: 'dt' });
      expect(row).toHaveTextContent(/weight \d+%/);
    }
  });
});
