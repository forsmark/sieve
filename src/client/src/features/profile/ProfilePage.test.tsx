import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ProfileDto } from '../../../../shared/api';
import { DEFAULT_PREFERENCES, type StructuredProfile } from '../../../../shared/schemas';
import { STATUS, mockApi, renderApp } from '../../test-utils';
import { resetToastsForTests } from '../../lib/toast';

const STRUCTURED: StructuredProfile = {
  headline: 'Frontend developer',
  skills: [{ name: 'TypeScript', level: 'strong', years: 5 }],
  roles: [{ title: 'Developer', company: 'Acme', start: '2020', end: null, summary: 'Builds web applications.' }],
  totalYears: 6,
  languages: ['English'],
  education: [],
};

function profile(extra: Partial<ProfileDto> = {}): ProfileDto {
  return {
    hasCv: true, cvText: 'Jane Doe. Frontend developer.', derived: STRUCTURED, effective: STRUCTURED, hasEdits: false,
    deriveState: 'idle', deriveError: null, updatedAt: '2026-11-01T10:00:00Z', ...extra,
  };
}

const NEW_CV = 'Jane Doe. Senior frontend developer with eight years of TypeScript.';

/** Opens the profile page. `imports()` holds the fields of every CV import request, for JSON and for file uploads. */
async function setup(initial: ProfileDto, routes: Parameters<typeof mockApi>[0] = {}) {
  const api = mockApi({
    'GET /api/auth/me': () => ({ authRequired: false, authenticated: true }),
    'GET /api/status': () => STATUS,
    'GET /api/profile': () => initial,
    'GET /api/preferences': () => DEFAULT_PREFERENCES,
    'POST /api/profile/cv': () => ({ ...initial, deriveState: 'pending' }),
    ...routes,
  });
  const user = userEvent.setup();
  renderApp('/profile');
  const section = within(await screen.findByRole('region', { name: 'CV' }));
  const imports = () =>
    api.fn.mock.calls
      .filter(([input, init]) => String(input) === '/api/profile/cv' && init?.method === 'POST')
      .map(([, init]) => (init!.body instanceof FormData ? Object.fromEntries(init!.body.entries()) : (JSON.parse(String(init!.body)) as Record<string, unknown>)));
  return { api, user, section, imports };
}

describe('CV import on the profile page', () => {
  beforeEach(() => resetToastsForTests());
  afterEach(() => {
    vi.unstubAllGlobals();
    resetToastsForTests();
  });

  it('asks whether to keep or discard the manual edits and sends "discard" when the user selects it', async () => {
    const { user, section, imports } = await setup(profile({ hasEdits: true }));
    const choice = within(section.getByRole('group', { name: 'Your profile edits' }));
    const keep = choice.getByRole('radio', { name: 'Keep my edits' });
    const discard = choice.getByRole('radio', { name: 'Discard my edits' });
    expect(keep).toBeChecked();
    expect(discard).not.toBeChecked();

    await user.click(discard);
    expect(discard).toBeChecked();
    await user.click(section.getByRole('radio', { name: 'Paste text' }));
    await user.type(section.getByLabelText('CV text'), NEW_CV);
    await user.click(section.getByRole('button', { name: 'Import CV' }));

    await waitFor(() => expect(imports()).toHaveLength(1));
    expect(imports()[0]).toEqual({ text: NEW_CV, edits: 'discard' });
  });

  it('sends "keep" with pasted text when the user leaves the choice at keep', async () => {
    const { user, section, imports } = await setup(profile({ hasEdits: true }));
    expect(section.getByRole('radio', { name: 'Keep my edits' })).toBeChecked();
    await user.click(section.getByRole('radio', { name: 'Paste text' }));
    await user.type(section.getByLabelText('CV text'), NEW_CV);
    await user.click(section.getByRole('button', { name: 'Import CV' }));

    await waitFor(() => expect(imports()).toHaveLength(1));
    expect(imports()[0]).toEqual({ text: NEW_CV, edits: 'keep' });
  });

  it('sends the choice with an uploaded file', async () => {
    const { user, section, imports } = await setup(profile({ hasEdits: true }));
    const file = new File([`# CV\n\n${NEW_CV}`], 'cv.md', { type: 'text/markdown' });
    await user.upload(section.getByLabelText('CV file'), file);
    await user.click(section.getByRole('radio', { name: 'Discard my edits' }));
    await user.click(section.getByRole('button', { name: 'Import CV' }));

    await waitFor(() => expect(imports()).toHaveLength(1));
    const sent = imports()[0]!;
    expect(sent.edits).toBe('discard');
    expect(sent.file).toBeInstanceOf(File);
    expect((sent.file as File).name).toBe('cv.md');
  });

  it('shows no choice when the profile has no manual edits', async () => {
    const { user, section, imports } = await setup(profile({ hasEdits: false }));
    expect(section.getByRole('button', { name: 'Import CV' })).toBeInTheDocument();
    expect(section.queryByRole('group', { name: 'Your profile edits' })).not.toBeInTheDocument();
    expect(section.queryByRole('radio', { name: 'Keep my edits' })).not.toBeInTheDocument();
    expect(section.queryByRole('radio', { name: 'Discard my edits' })).not.toBeInTheDocument();

    await user.click(section.getByRole('radio', { name: 'Paste text' }));
    await user.type(section.getByLabelText('CV text'), NEW_CV);
    await user.click(section.getByRole('button', { name: 'Import CV' }));
    await waitFor(() => expect(imports()).toHaveLength(1));
    expect(imports()[0]).toMatchObject({ text: NEW_CV });
  });
});

describe('Location in the score', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('sets the location weight to 0 when the user turns the switch off, and restores the default when on again', async () => {
    const { user } = await setup(profile());
    const toggle = await screen.findByRole('switch', { name: /Count location in the score/ });
    const weight = screen.getByRole('spinbutton', { name: 'Location weight' });
    expect(toggle).toHaveAttribute('aria-checked', 'true');
    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    expect(weight).toHaveValue(0);
    await user.click(toggle);
    expect(weight).toHaveValue(DEFAULT_PREFERENCES.weights.location);
  });
});

describe('Structured profile', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('shows the derived profile for review in the editor', async () => {
    await setup(profile());
    const section = within(await screen.findByRole('region', { name: 'Structured profile' }));
    expect(section.getByLabelText('Headline')).toHaveValue('Frontend developer');
    expect(section.getByLabelText('Total years of experience')).toHaveValue(6);
    expect(section.getByLabelText('Skill 1 name')).toHaveValue('TypeScript');
    expect(section.getByLabelText('Skill 1 level')).toHaveValue('strong');
    expect(section.getByDisplayValue('Developer')).toBeInTheDocument();
  });

  it('says that no profile exists yet and offers to build it from the CV', async () => {
    let derives = 0;
    const { user } = await setup(profile({ derived: null, effective: null }), {
      'POST /api/profile/derive': () => {
        derives++;
        return profile({ derived: null, effective: null, deriveState: 'pending' });
      },
    });
    expect(await screen.findByText('No profile exists yet.')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Structured profile' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Build profile from CV' }));
    await waitFor(() => expect(derives).toBe(1));
  });
});

describe('Hard and soft rules', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    resetToastsForTests();
  });

  it('saves the language rule as hard and keeps the marks of the location and work arrangement rules', async () => {
    const puts: Array<{ dryRun: boolean; body: Record<string, unknown> }> = [];
    const { user } = await setup(profile(), {
      'PUT /api/preferences': (c, url) => {
        puts.push({ dryRun: url.searchParams.has('dryRun'), body: c.body as Record<string, unknown> });
        return { preferences: c.body, plan: { rulesOnly: 2, judge: 0, extract: 0 } };
      },
    });
    const rule = (name: string) => within(screen.getByRole('group', { name }));
    await screen.findByRole('group', { name: 'Language rule' });
    // Each of the three rules offers a hard and a soft choice. Excluded companies have no such choice.
    for (const name of ['Location rule', 'Language rule', 'Work arrangement rule']) {
      expect(rule(name).getByRole('radio', { name: 'Soft: lowers the score' })).toBeChecked();
      expect(rule(name).getByRole('radio', { name: 'Hard: excludes the posting' })).not.toBeChecked();
    }

    await user.click(rule('Language rule').getByRole('radio', { name: 'Hard: excludes the posting' }));
    await user.click(screen.getByRole('button', { name: 'Review and save' }));
    await user.click(await screen.findByRole('button', { name: 'Save preferences' }));

    await waitFor(() => expect(puts.filter((p) => !p.dryRun)).toHaveLength(1));
    const saved = puts.find((p) => !p.dryRun)!.body;
    expect(saved).toMatchObject({ languageMode: 'hard', locationMode: 'soft', workArrangementMode: 'soft' });
    expect(await screen.findByText(/Preferences saved/)).toBeInTheDocument();
  });
});
