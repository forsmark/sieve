import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import type { MatchDetail, PostingDetail } from '../../../../shared/api';
import { STATUS, makeItem, mockApi, renderApp } from '../../test-utils';
import { resetToastsForTests } from '../../lib/toast';

function match(extra: Partial<MatchDetail> = {}): MatchDetail {
  return {
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
    assessment: 'You fit the stack.',
    softViolations: [],
    provider: 'local',
    model: 'm',
    ...extra,
  };
}

function open(m: MatchDetail) {
  const item = makeItem('7', 82);
  const detail: PostingDetail = {
    ...item,
    description: 'Build things.',
    facts: {
      requiredSkills: ['React'],
      optionalSkills: [],
      seniority: 'senior',
      workArrangement: 'remote',
      location: { city: 'Copenhagen', country: 'Denmark' },
      requiredLanguages: [],
      salary: null,
      summary: 'A frontend role.',
    },
    sourceLinks: [{ id: '7', source: 'jobindex', url: item.url, primary: true }],
    application: null,
    coverLetter: null,
    matchAnalysis: null,
    match: m,
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
}

/** The mosaic tile whose heading has this name. */
async function tile(name: string | RegExp): Promise<HTMLElement> {
  return (await screen.findByRole('heading', { name, level: 3 })).closest('section') as HTMLElement;
}

describe('detail mosaic', () => {
  beforeEach(() => resetToastsForTests());
  afterEach(() => {
    vi.unstubAllGlobals();
    resetToastsForTests();
  });

  it('puts the facts and the description before the cover letter and the analysis on a mosaic narrower than 768px', async () => {
    open(match());
    const facts = await tile('Facts');
    const description = await tile('Description');
    const letter = await tile('Cover letter');
    const analysis = await tile('Expanded analysis');
    const sources = await tile(/^Sources/);
    // CSS order moves the letter, the analysis and the sources after the rest below the 3xl container width (48rem).
    for (const t of [letter, analysis, sources]) expect(t).toHaveClass('@max-3xl:order-1');
    for (const t of [facts, description]) expect(t.className).not.toMatch(/order-/);
    // The document order stays, so the tab order on wide screens does not change.
    expect(letter.compareDocumentPosition(facts) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // Below 768px the facts follow the assessment, so the assessment has no down notch to the letter.
    const assessment = await tile('Assessment');
    expect(assessment).toHaveClass('@3xl:notch-right');
    expect(assessment.className).not.toMatch(/notch-down/);
  });

  it('shrinks an empty "Missing skills" tile to one line', async () => {
    open(match({ missingSkills: [] }));
    const missing = await tile('Missing skills: none');
    expect(missing).toHaveTextContent(/^Missing skills: none$/);
    expect(within(missing).queryByRole('list')).not.toBeInTheDocument();
    expect(missing).toHaveClass('col-span-6', 'py-3');
    // It sits below "Matched skills" and above the assessment, so it carries the notch.
    expect(missing).toHaveClass('notch-down');
    const matched = await tile('Matched skills (2)');
    expect(matched).toHaveClass('col-span-6');
    expect(matched.className).not.toMatch(/notch/);
  });

  it('keeps the two skill tiles side by side when skills are missing', async () => {
    open(match());
    const missing = await tile('Missing skills (1)');
    expect(within(missing).getByRole('list', { name: 'Missing skills' })).toHaveTextContent('Go');
    expect(missing).toHaveClass('@md:col-span-3');
    expect(await tile('Matched skills (2)')).toHaveClass('@md:col-span-3', '@md:notch-down');
  });
});
