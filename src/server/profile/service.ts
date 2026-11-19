import { sqlite, parseJson } from '../kernel/db';
import { nowIso } from '../kernel/clock';
import { publish } from '../kernel/events';
import { enqueue } from '../kernel/tasks';
import { sha } from '../ingestion/normalize';
import { DEFAULT_PREFERENCES, EMPTY_PROFILE, Preferences, StructuredProfile } from '../../shared/schemas';

interface ProfileRow {
  cv_text: string;
  derived_json: string | null;
  edits_json: string;
  derive_state: string;
  derive_error: string | null;
  updated_at: string;
}

export interface ProfileView {
  hasCv: boolean;
  cvText: string;
  derived: StructuredProfile | null;
  edits: Partial<StructuredProfile>;
  /** The derived profile with the manual edits applied on top. Null until a profile exists. */
  effective: StructuredProfile | null;
  hasEdits: boolean;
  deriveState: 'idle' | 'pending' | 'failed';
  deriveError: string | null;
  updatedAt: string | null;
}

function row(): ProfileRow | undefined {
  return sqlite.prepare('SELECT * FROM profile WHERE id = 1').get() as ProfileRow | undefined;
}

export function getProfile(): ProfileView {
  const r = row();
  if (!r) {
    return { hasCv: false, cvText: '', derived: null, edits: {}, effective: null, hasEdits: false, deriveState: 'idle', deriveError: null, updatedAt: null };
  }
  const derived = parseJson<StructuredProfile | null>(r.derived_json, null);
  const edits = parseJson<Partial<StructuredProfile>>(r.edits_json, {});
  const hasEdits = Object.keys(edits).length > 0;
  // A profile exists when the model derived one, or when the user filled one by hand.
  const effective = derived || hasEdits ? { ...EMPTY_PROFILE, ...(derived ?? {}), ...edits } : null;
  return {
    hasCv: true,
    cvText: r.cv_text,
    derived,
    edits,
    effective,
    hasEdits,
    deriveState: r.derive_state as ProfileView['deriveState'],
    deriveError: r.derive_error,
    updatedAt: r.updated_at,
  };
}

export function getEffectiveProfile(): StructuredProfile | null {
  return getProfile().effective;
}

/** Stores a new CV text and starts the derivation of the structured profile. */
export function importCv(cvText: string, edits: 'keep' | 'discard'): void {
  const text = cvText.trim();
  if (!text) throw new Error('The CV has no readable text. Upload a text-based document.');
  const existing = row();
  const editsJson = edits === 'keep' && existing ? existing.edits_json : '{}';
  sqlite
    .prepare(
      `INSERT INTO profile (id, cv_text, derived_json, edits_json, derive_state, derive_error, updated_at)
       VALUES (1, ?, NULL, ?, 'pending', NULL, ?)
       ON CONFLICT(id) DO UPDATE SET cv_text = excluded.cv_text, edits_json = excluded.edits_json,
         derive_state = 'pending', derive_error = NULL, updated_at = excluded.updated_at`,
    )
    .run(text, editsJson, nowIso());
  enqueue('derive_profile', 'profile', { priority: Number.MAX_SAFE_INTEGER });
  publish({ type: 'profile.updated' });
}

export function requestDerive(): void {
  if (!row()) throw new Error('Import a CV first.');
  sqlite.prepare(`UPDATE profile SET derive_state = 'pending', derive_error = NULL WHERE id = 1`).run();
  enqueue('derive_profile', 'profile', { priority: Number.MAX_SAFE_INTEGER });
  publish({ type: 'profile.updated' });
}

export function storeDerived(derived: StructuredProfile): void {
  sqlite.prepare(`UPDATE profile SET derived_json = ?, derive_state = 'idle', derive_error = NULL, updated_at = ? WHERE id = 1`).run(JSON.stringify(derived), nowIso());
  publish({ type: 'profile.updated' });
}

export function storeDeriveFailure(error: string): void {
  sqlite.prepare(`UPDATE profile SET derive_state = 'failed', derive_error = ? WHERE id = 1`).run(error);
  publish({ type: 'profile.updated' });
}

/**
 * Saves the profile as the user edited it.
 * Only the fields that differ from the derived profile are stored as edits, so a later derivation keeps them.
 */
export function saveProfileEdits(next: StructuredProfile): void {
  const parsed = StructuredProfile.parse(next);
  const r = row();
  const derived = parseJson<StructuredProfile | null>(r?.derived_json, null) ?? EMPTY_PROFILE;
  const edits: Record<string, unknown> = {};
  for (const key of Object.keys(parsed) as Array<keyof StructuredProfile>) {
    if (JSON.stringify(parsed[key]) !== JSON.stringify(derived[key])) edits[key] = parsed[key];
  }
  sqlite
    .prepare(
      `INSERT INTO profile (id, cv_text, derived_json, edits_json, derive_state, updated_at) VALUES (1, '', NULL, ?, 'idle', ?)
       ON CONFLICT(id) DO UPDATE SET edits_json = excluded.edits_json, updated_at = excluded.updated_at`,
    )
    .run(JSON.stringify(edits), nowIso());
  publish({ type: 'profile.updated' });
}

export function discardEdits(): void {
  sqlite.prepare(`UPDATE profile SET edits_json = '{}', updated_at = ? WHERE id = 1`).run(nowIso());
  publish({ type: 'profile.updated' });
}

// ---- Preferences

export function getPreferences(): Preferences {
  const r = sqlite.prepare('SELECT prefs_json FROM preferences WHERE id = 1').get() as { prefs_json: string } | undefined;
  const stored = parseJson<Partial<Preferences>>(r?.prefs_json, {});
  return { ...DEFAULT_PREFERENCES, ...stored };
}

/** Validates and stores the preferences. An invalid value throws, and the earlier preferences stay. */
/** Validates preferences and removes empty and repeated list entries. Stores nothing. */
export function parsePreferences(input: unknown): Preferences {
  const parsed = Preferences.parse(input);
  return {
    ...parsed,
    locations: tidy(parsed.locations),
    commutableLocations: tidy(parsed.commutableLocations),
    wantedTech: tidy(parsed.wantedTech),
    unwantedTech: tidy(parsed.unwantedTech),
    excludedCompanies: tidy(parsed.excludedCompanies),
  };
}

export function savePreferences(input: unknown): Preferences {
  const clean = parsePreferences(input);
  sqlite
    .prepare(
      `INSERT INTO preferences (id, prefs_json, updated_at) VALUES (1, ?, ?)
       ON CONFLICT(id) DO UPDATE SET prefs_json = excluded.prefs_json, updated_at = excluded.updated_at`,
    )
    .run(JSON.stringify(clean), nowIso());
  publish({ type: 'profile.updated' });
  return clean;
}

function tidy(list: string[]): string[] {
  return [...new Set(list.map((s) => s.trim()).filter(Boolean))];
}

// ---- Versions

export interface Versions {
  /** Changes when the judge would read different input. A new value needs one model call for each posting. */
  judgeVersion: string;
  /** Changes when the code rules or the weights change. A new value needs no model call. */
  ruleVersion: string;
}

/** The part of the profile and preferences that the judge reads. Spoken languages are not in it, because code checks them. */
export function judgeInput(profile: StructuredProfile, prefs: Preferences) {
  return {
    profile: {
      headline: profile.headline,
      skills: profile.skills,
      roles: profile.roles,
      totalYears: profile.totalYears,
      education: profile.education,
    },
    preferences: {
      seniority: prefs.seniority,
      minSalary: prefs.minSalary,
      salaryCurrency: prefs.salaryCurrency,
      wantedTech: prefs.wantedTech,
      unwantedTech: prefs.unwantedTech,
      notes: prefs.notes,
    },
  };
}

/** The input of the code rules: constraints, location fit, penalties, and weights. */
export function ruleInput(profile: StructuredProfile, prefs: Preferences) {
  return {
    languages: [...profile.languages].map((l) => l.toLowerCase()).sort(),
    locations: prefs.locations,
    commutableLocations: prefs.commutableLocations,
    locationMode: prefs.locationMode,
    workArrangements: [...prefs.workArrangements].sort(),
    workArrangementMode: prefs.workArrangementMode,
    languageMode: prefs.languageMode,
    excludedCompanies: prefs.excludedCompanies,
    weights: prefs.weights,
  };
}

export function computeVersions(profile: StructuredProfile, prefs: Preferences): Versions {
  return {
    judgeVersion: sha(JSON.stringify(judgeInput(profile, prefs))),
    ruleVersion: sha(JSON.stringify(ruleInput(profile, prefs))),
  };
}

/** Null while no structured profile exists. */
export function currentVersions(): Versions | null {
  const profile = getEffectiveProfile();
  if (!profile) return null;
  return computeVersions(profile, getPreferences());
}
