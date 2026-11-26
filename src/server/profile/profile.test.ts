import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../http/app';
import { setPasswordForTests } from '../http/auth';
import { whenIdle } from '../kernel/tasks';
import { ingestPosting } from '../ingestion/ingest';
import { registerMatchingHandlers } from '../matching/handlers';
import { planRescore } from '../matching/rescore';
import { updateSchedule } from '../sources/schedule';
import { FACTS, JUDGMENT, PROFILE, matchOf, raw, resetAll, stubLlm } from '../testing/helpers';
import { DEFAULT_PREFERENCES, type Preferences } from '../../shared/schemas';
import { CvImportError, cleanCvText, extractCvText } from './cv-import';
import { registerDeriveHandler } from './derive';
import {
  computeVersions,
  currentVersions,
  discardEdits,
  getPreferences,
  getProfile,
  importCv,
  requestDerive,
  saveProfileEdits,
  savePreferences,
} from './service';

/** Collects one posting and returns its id. */
function add(overrides: Parameters<typeof raw>[0] = {}): string {
  const result = ingestPosting('a', raw(overrides));
  if (result.status === 'invalid') throw new Error('invalid');
  return result.id;
}

const CV = 'Jane Doe. Frontend developer with six years of TypeScript and React experience in Copenhagen.';

beforeEach(resetAll);

/** Builds a small valid PDF. With no text, the page is empty, like a scanned document. */
function pdf(text: string): Uint8Array {
  const stream = text ? `BT /F1 12 Tf 40 700 Td (${text}) Tj ET` : '';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const o of offsets) out += `${String(o).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(out);
}

describe('CV import', () => {
  it('extracts the text of a text-based PDF', async () => {
    const text = await extractCvText({ name: 'cv.pdf', type: 'application/pdf', bytes: pdf(CV) });
    expect(text).toContain('Frontend developer with six years');
  });

  it('rejects a PDF without text and explains what the system needs', async () => {
    await expect(extractCvText({ name: 'scan.pdf', type: 'application/pdf', bytes: pdf('') })).rejects.toThrow(CvImportError);
    await expect(extractCvText({ name: 'scan.pdf', type: 'application/pdf', bytes: pdf('') })).rejects.toThrow(/text-based document/);
  });

  it('rejects a file that is not a document', async () => {
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0, 1, 2, 3]);
    await expect(extractCvText({ name: 'photo.png', bytes })).rejects.toThrow(CvImportError);
    await expect(extractCvText({ name: 'broken.pdf', bytes: new TextEncoder().encode('%PDF-1.4 broken') })).rejects.toThrow(CvImportError);
  });

  it('accepts Markdown and pasted text', async () => {
    const md = `# Jane Doe\r\n\r\n\r\n\r\n- ${CV}   \r\n`;
    expect(await extractCvText({ name: 'cv.md', bytes: new TextEncoder().encode(md) })).toBe(`# Jane Doe\n\n- ${CV}`);
    expect(cleanCvText(`  ${CV}  `)).toBe(CV);
    expect(() => cleanCvText('   \n ')).toThrow(/no readable text/);
  });
});

describe('profile derivation', () => {
  it('produces a structured profile from the CV', async () => {
    const stub = stubLlm();
    registerDeriveHandler();
    importCv(CV, 'keep');
    expect(getProfile()).toMatchObject({ hasCv: true, deriveState: 'pending', effective: null });
    await whenIdle();
    expect(stub.calls.derive).toBe(1);
    expect(getProfile()).toMatchObject({ deriveState: 'idle', derived: PROFILE, effective: PROFILE, cvText: CV });
  });

  it('keeps the CV text, reports the failure, and lets the user retry or fill the profile by hand', async () => {
    const stub = stubLlm();
    registerDeriveHandler();
    stub.profile = () => ({ headline: 42 });
    importCv(CV, 'keep');
    await whenIdle();
    let p = getProfile();
    expect(p.deriveState).toBe('failed');
    expect(p.deriveError).toBeTruthy();
    expect(p.cvText).toBe(CV);
    expect(p.effective).toBeNull();

    // The user fills the profile by hand.
    saveProfileEdits(PROFILE);
    expect(getProfile().effective).toEqual(PROFILE);

    // The user retries, and the model now answers.
    stub.profile = () => PROFILE;
    requestDerive();
    await whenIdle();
    p = getProfile();
    expect(p.deriveState).toBe('idle');
    expect(p.derived).toEqual(PROFILE);
  });

  it('rejects an empty CV', () => {
    expect(() => importCv('   ', 'keep')).toThrow(/no readable text/);
  });
});

describe('manual edits', () => {
  it('stores a corrected skill level as an edit over the derived profile', async () => {
    stubLlm();
    registerDeriveHandler();
    importCv(CV, 'keep');
    await whenIdle();
    const edited = { ...PROFILE, skills: [{ name: 'TypeScript', level: 'expert' as const, years: 5 }] };
    saveProfileEdits(edited);
    const p = getProfile();
    expect(p.hasEdits).toBe(true);
    expect(Object.keys(p.edits)).toEqual(['skills']);
    expect(p.derived).toEqual(PROFILE);
    expect(p.effective!.skills[0]!.level).toBe('expert');
  });

  it('keeps the edits when the user imports a new CV and chooses to keep them', async () => {
    const stub = stubLlm();
    registerDeriveHandler();
    importCv(CV, 'keep');
    await whenIdle();
    saveProfileEdits({ ...PROFILE, headline: 'My own headline' });
    stub.profile = () => ({ ...PROFILE, headline: 'Derived again', totalYears: 9 });
    importCv(`${CV} New job in 2026.`, 'keep');
    await whenIdle();
    const p = getProfile();
    expect(p.effective!.headline).toBe('My own headline');
    expect(p.effective!.totalYears).toBe(9);
  });

  it('uses a corrected skill level for later matches', async () => {
    const stub = stubLlm();
    registerMatchingHandlers();
    let seen = '';
    stub.judgment = (user) => ((seen = user), JUDGMENT);
    saveProfileEdits(PROFILE);
    add();
    await whenIdle();
    expect(JSON.parse(seen).profile.skills).toEqual([{ name: 'TypeScript', level: 'strong', years: 5 }]);

    saveProfileEdits({ ...PROFILE, skills: [{ name: 'TypeScript', level: 'expert', years: 5 }] });
    expect(getProfile().effective!.skills).toEqual([{ name: 'TypeScript', level: 'expert', years: 5 }]);
    expect(planRescore()).toMatchObject({ judge: 1 });
    await whenIdle();
    expect(JSON.parse(seen).profile.skills).toEqual([{ name: 'TypeScript', level: 'expert', years: 5 }]);
  });

  it('drops the edits when the user chooses to discard them', async () => {
    const stub = stubLlm();
    registerDeriveHandler();
    importCv(CV, 'keep');
    await whenIdle();
    saveProfileEdits({ ...PROFILE, headline: 'My own headline' });
    stub.profile = () => ({ ...PROFILE, headline: 'Derived again' });
    importCv(CV, 'discard');
    await whenIdle();
    expect(getProfile()).toMatchObject({ hasEdits: false });
    expect(getProfile().effective!.headline).toBe('Derived again');
    saveProfileEdits({ ...PROFILE, headline: 'Again mine' });
    discardEdits();
    expect(getProfile().hasEdits).toBe(false);
  });
});

describe('preferences', () => {
  it('uses the default weights 40, 25, 20, and 15 until the user changes them', async () => {
    expect(getPreferences().weights).toEqual({ skills: 40, experience: 25, preferences: 20, location: 15 });
    stubLlm();
    registerMatchingHandlers();
    saveProfileEdits(PROFILE);
    const id = add();
    await whenIdle();
    // (80 * 40 + 70 * 25 + 60 * 20 + 100 * 15) / 100 = 76.5
    expect(matchOf(id)).toMatchObject({ skills_score: 80, experience_score: 70, preference_score: 60, location_score: 100, total_score: 77 });
  });

  it('stores valid preferences and removes empty and repeated list entries', () => {
    const saved = savePreferences({ ...DEFAULT_PREFERENCES, locations: [' Copenhagen ', '', 'Copenhagen'], locationMode: 'hard', minSalary: 50000 });
    expect(saved.locations).toEqual(['Copenhagen']);
    expect(getPreferences()).toMatchObject({ locations: ['Copenhagen'], locationMode: 'hard', minSalary: 50000 });
  });

  it('stores saved preferences and reports the postings whose scores are now out of date', async () => {
    stubLlm();
    registerMatchingHandlers();
    setPasswordForTests(undefined);
    saveProfileEdits(PROFILE);
    add();
    add({ externalId: 'job-2', title: 'Data Engineer' });
    await whenIdle();
    const next: Preferences = { ...DEFAULT_PREFERENCES, excludedCompanies: ['Beta Corp'], notes: 'No consulting.' };
    const res = await createApp().request('/api/preferences', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(next),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { preferences: Preferences; plan: unknown };
    // The notes go to the judge, so both stored scores are out of date and need a new judgment.
    expect(body.plan).toEqual({ rulesOnly: 0, judge: 2, extract: 0 });
    expect(body.preferences).toEqual(next);
    expect(getPreferences()).toEqual(next);
  });

  it('computes the total without location when its weight is 0, and a hard location still excludes', async () => {
    const stub = stubLlm();
    registerMatchingHandlers();
    saveProfileEdits(PROFILE);
    stub.facts = (user) => (user.includes('Aalborg') ? { ...FACTS, location: { city: 'Aalborg', country: 'Denmark' }, workArrangement: 'onsite' } : FACTS);
    savePreferences({
      ...DEFAULT_PREFERENCES,
      locations: ['Copenhagen'],
      locationMode: 'hard',
      weights: { ...DEFAULT_PREFERENCES.weights, location: 0 },
    });
    const inside = add();
    const outside = add({ externalId: 'job-2', title: 'Developer in Aalborg', location: 'Aalborg' });
    await whenIdle();
    // (80 * 40 + 70 * 25 + 60 * 20) / 85 = 72.4. With location counted at 15 the total would be 77.
    expect(matchOf(inside)).toMatchObject({ state: 'scored', location_score: 100, total_score: 72 });
    expect(matchOf(outside)).toMatchObject({ state: 'excluded', excluded_reason: 'location: Aalborg, Denmark', total_score: null });
  });

  it.each([
    ['a negative minimum salary', { minSalary: -1 }],
    ['a weight above 100', { weights: { ...DEFAULT_PREFERENCES.weights, skills: 101 } }],
    ['all weights at 0', { weights: { skills: 0, experience: 0, preferences: 0, location: 0 } }],
    ['an unknown mode', { locationMode: 'maybe' }],
    ['an unknown work arrangement', { workArrangements: ['space'] }],
  ])('rejects %s and keeps the earlier preferences', (_name, patch) => {
    savePreferences({ ...DEFAULT_PREFERENCES, minSalary: 40000 });
    expect(() => savePreferences({ ...DEFAULT_PREFERENCES, ...patch })).toThrow();
    expect(getPreferences().minSalary).toBe(40000);
  });
});

describe('versions', () => {
  const base = computeVersions(PROFILE, DEFAULT_PREFERENCES);

  it('has no version before a profile exists', () => {
    expect(currentVersions()).toBeNull();
    saveProfileEdits(PROFILE);
    expect(currentVersions()).toEqual(base);
  });

  it('changes only the judge version when a skill is added', () => {
    const v = computeVersions({ ...PROFILE, skills: [...PROFILE.skills, { name: 'Rust', level: 'basic', years: 1 }] }, DEFAULT_PREFERENCES);
    expect(v.judgeVersion).not.toBe(base.judgeVersion);
    expect(v.ruleVersion).toBe(base.ruleVersion);
  });

  it.each([
    ['seniority', { seniority: 'senior' as const }],
    ['minimum salary', { minSalary: 60000 }],
    ['wanted technologies', { wantedTech: ['Rust'] }],
    ['notes', { notes: 'No consulting.' }],
  ])('changes only the judge version when %s changes', (_name, patch) => {
    const v = computeVersions(PROFILE, { ...DEFAULT_PREFERENCES, ...patch });
    expect(v.judgeVersion).not.toBe(base.judgeVersion);
    expect(v.ruleVersion).toBe(base.ruleVersion);
  });

  it.each([
    ['weights', { weights: { ...DEFAULT_PREFERENCES.weights, skills: 60 } }],
    ['excluded companies', { excludedCompanies: ['Acme'] }],
    ['locations', { locations: ['Aarhus'] }],
    ['the location mode', { locationMode: 'hard' as const }],
    ['work arrangements', { workArrangements: ['remote' as const] }],
    ['the language mode', { languageMode: 'hard' as const }],
  ])('changes only the rule version when %s change', (_name, patch) => {
    const v = computeVersions(PROFILE, { ...DEFAULT_PREFERENCES, ...patch });
    expect(v.ruleVersion).not.toBe(base.ruleVersion);
    expect(v.judgeVersion).toBe(base.judgeVersion);
  });

  it('changes only the rule version when the spoken languages change', () => {
    const v = computeVersions({ ...PROFILE, languages: ['English'] }, DEFAULT_PREFERENCES);
    expect(v.ruleVersion).not.toBe(base.ruleVersion);
    expect(v.judgeVersion).toBe(base.judgeVersion);
  });

  it('keeps both versions when a setting changes that the match does not use', () => {
    saveProfileEdits(PROFILE);
    const before = currentVersions();
    updateSchedule({ intervalHours: 9 });
    savePreferences({ ...DEFAULT_PREFERENCES, autoDismiss: { enabled: true, threshold: 30 } });
    expect(currentVersions()).toEqual(before);
  });
});
