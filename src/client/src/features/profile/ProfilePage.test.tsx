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
async function setup(initial: ProfileDto) {
  const api = mockApi({
    'GET /api/auth/me': () => ({ authRequired: false, authenticated: true }),
    'GET /api/status': () => STATUS,
    'GET /api/profile': () => initial,
    'GET /api/preferences': () => DEFAULT_PREFERENCES,
    'POST /api/profile/cv': () => ({ ...initial, deriveState: 'pending' }),
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
