import { beforeEach, describe, expect, it } from 'vitest';
import { sqlite } from '../kernel/db';
import { setSetting } from '../kernel/settings';
import { MAX_ATTEMPTS, recoverRunningTasks, whenIdle } from '../kernel/tasks';
import { ingestPosting } from '../ingestion/ingest';
import { listPostings, getPostingDetail, setTriage } from '../http/postings';
import { InvalidOutputError, ProviderUnavailableError, probe } from '../llm';
import { registerDeriveHandler } from '../profile/derive';
import { currentVersions, getPreferences, saveProfileEdits, savePreferences } from '../profile/service';
import { createOpenAiClient } from '../llm/openai';
import { setLlmClientForTests } from '../llm';
import { createApp } from '../http/app';
import { setPasswordForTests } from '../http/auth';
import { FACTS, JUDGMENT, PROFILE, fakeClock, matchOf, postingOf, raw, resetAll, stubLlm, tasksOf, type StubLlm } from '../testing/helpers';
import { DEFAULT_PREFERENCES, type PostingFacts, type Preferences } from '../../shared/schemas';
import { getFacts, registerMatchingHandlers } from './handlers';
import { planRescore, rescorePostings } from './rescore';
import { SOFT_PENALTY, classifyLocation, evaluateConstraints, locationScore, totalScore } from './rules';

let stub: StubLlm;

beforeEach(async () => {
  await resetAll();
  stub = stubLlm();
  registerMatchingHandlers();
  registerDeriveHandler();
});

function add(overrides: Parameters<typeof raw>[0] = {}): string {
  const result = ingestPosting('a', raw(overrides));
  if (result.status === 'invalid') throw new Error('invalid');
  return result.id;
}

const prefs = (patch: Partial<Preferences> = {}): Preferences => ({ ...DEFAULT_PREFERENCES, ...patch });
const facts = (patch: Partial<PostingFacts> = {}): PostingFacts => ({ ...FACTS, ...patch });
const NOWHERE = { city: null, country: null };

describe('constraints in code', () => {
  const posting = { company: 'Acme A/S' };

  it('excludes a company on the excluded list with the reason "excluded company"', () => {
    const r = evaluateConstraints(posting, facts(), PROFILE, prefs({ excludedCompanies: ['ACME ApS'] }));
    expect(r.excludedReason).toBe('excluded company');
    expect(evaluateConstraints({ company: 'Other' }, facts(), PROFILE, prefs({ excludedCompanies: ['Acme'] })).excludedReason).toBeNull();
  });

  it('excludes a posting that requires a language the profile lacks, and names the language, when language is hard', () => {
    const r = evaluateConstraints(posting, facts({ requiredLanguages: ['Danish', 'German'] }), PROFILE, prefs({ languageMode: 'hard' }));
    expect(r.excludedReason).toBe('language: German');
  });

  it('adds a penalty and does not exclude when language is soft', () => {
    const r = evaluateConstraints(posting, facts({ requiredLanguages: ['German'] }), PROFILE, prefs({ languageMode: 'soft' }));
    expect(r.excludedReason).toBeNull();
    expect(r.softViolations).toEqual([{ kind: 'language', detail: 'German' }]);
  });

  it('excludes a job outside the accepted and commutable locations when location is hard, unless it is remote', () => {
    const p = prefs({ locations: ['Copenhagen'], commutableLocations: ['Roskilde'], locationMode: 'hard' });
    const at = (city: string, workArrangement: PostingFacts['workArrangement'] = 'onsite') =>
      evaluateConstraints(posting, facts({ location: { city, country: 'Denmark' }, workArrangement }), PROFILE, p).excludedReason;
    expect(at('Aalborg')).toBe('location: Aalborg, Denmark');
    expect(at('Copenhagen')).toBeNull();
    expect(at('Roskilde')).toBeNull();
    expect(at('Aalborg', 'remote')).toBeNull();
  });

  it('excludes a work arrangement the user does not accept when that constraint is hard, and adds a penalty when it is soft', () => {
    const hard = evaluateConstraints(
      posting,
      facts({ workArrangement: 'onsite' }),
      PROFILE,
      prefs({ workArrangements: ['remote'], workArrangementMode: 'hard' }),
    );
    expect(hard.excludedReason).toBe('work arrangement: onsite');
    const soft = evaluateConstraints(posting, facts({ workArrangement: 'onsite' }), PROFILE, prefs({ workArrangements: ['remote'] }));
    expect(soft).toEqual({ excludedReason: null, softViolations: [{ kind: 'work_arrangement', detail: 'onsite' }] });
  });

  it('never excludes and never adds a penalty for an unknown fact', () => {
    const p = prefs({
      locations: ['Copenhagen'],
      locationMode: 'hard',
      languageMode: 'hard',
      workArrangements: ['remote'],
      workArrangementMode: 'hard',
    });
    const unknown = facts({ location: NOWHERE, workArrangement: null, requiredLanguages: [] });
    expect(evaluateConstraints(posting, unknown, PROFILE, p)).toEqual({ excludedReason: null, softViolations: [] });
    // A profile without languages gives the system nothing to compare with.
    const r = evaluateConstraints(posting, facts({ requiredLanguages: ['German'] }), { ...PROFILE, languages: [] }, prefs({ languageMode: 'hard' }));
    expect(r.excludedReason).toBeNull();
  });
});

describe('scores in code', () => {
  it('gives the location fit from the accepted, commutable, remote, unknown, and outside classes', () => {
    const p = prefs({ locations: ['Copenhagen', 'Sweden'], commutableLocations: ['Roskilde'] });
    const at = (city: string | null, country: string | null, workArrangement: PostingFacts['workArrangement'] = 'onsite') =>
      locationScore(facts({ location: { city, country }, workArrangement }), p);
    expect(at('Greater Copenhagen', 'Denmark')).toBe(100);
    expect(at('Malmö', 'Sweden')).toBe(100);
    expect(at('Roskilde', 'Denmark')).toBe(80);
    expect(at(null, null)).toBe(70);
    expect(at('Aalborg', 'Denmark')).toBe(0);
    expect(at('Aalborg', 'Denmark', 'remote')).toBe(100);
    expect(classifyLocation(facts(), prefs())).toBe('no_preference');
    expect(locationScore(facts(), prefs())).toBe(100);
  });

  it('computes the weighted mean and always gives the same total for the same input', () => {
    const scores = { skills: 80, experience: 70, preferences: 60, location: 100 };
    const w = DEFAULT_PREFERENCES.weights;
    // (80*40 + 70*25 + 60*20 + 100*15) / 100 = 76.5
    expect(totalScore(scores, w, [])).toBe(77);
    for (let i = 0; i < 20; i++) expect(totalScore(scores, w, [])).toBe(77);
    expect(totalScore(scores, { skills: 100, experience: 0, preferences: 0, location: 0 }, [])).toBe(80);
    expect(totalScore(scores, { skills: 2, experience: 1, preferences: 1, location: 0 }, [])).toBe(73);
  });

  it('subtracts a fixed penalty for each violated soft constraint and stays in the range 0 to 100', () => {
    const scores = { skills: 80, experience: 70, preferences: 60, location: 100 };
    const w = DEFAULT_PREFERENCES.weights;
    expect(totalScore(scores, w, [{ kind: 'language', detail: 'German' }])).toBe(77 - SOFT_PENALTY.language);
    expect(
      totalScore(scores, w, [
        { kind: 'language', detail: 'x' },
        { kind: 'work_arrangement', detail: 'onsite' },
      ]),
    ).toBe(32);
    expect(totalScore({ skills: 10, experience: 10, preferences: 10, location: 10 }, w, [{ kind: 'language', detail: 'x' }])).toBe(0);
  });
});

describe('pipeline', () => {
  beforeEach(() => saveProfileEdits(PROFILE));

  it('shows a new posting as "waiting", then stores facts, one score for each dimension, and the explanation', async () => {
    const id = add();
    expect(listPostings({}).items[0]!.match).toMatchObject({ state: 'waiting', totalScore: null });
    await whenIdle();
    expect(getFacts(id)).toEqual(FACTS);
    expect(matchOf(id)).toMatchObject({
      state: 'scored',
      skills_score: 80,
      experience_score: 70,
      preference_score: 60,
      location_score: 100,
      total_score: 77,
      provider: 'local',
      model: 'stub-model',
    });
    const detail = getPostingDetail(id)!;
    expect(detail.match).toMatchObject({
      matchedSkills: ['TypeScript'],
      missingSkills: ['React'],
      assessment: JUDGMENT.assessment,
      stale: false,
      skillsScore: 80,
      experienceScore: 70,
      preferenceScore: 60,
      locationScore: 100,
    });
    expect(stub.calls).toMatchObject({ extract: 1, judge: 1 });
    // The same posting in the list now has its score.
    expect(listPostings({}).items.map((i) => [i.id, i.match])).toEqual([[id, { state: 'scored', totalScore: 77, stale: false, excludedReason: null }]]);
  });

  it('stores an unknown fact as unknown', async () => {
    stub.facts = () => facts({ salary: null, workArrangement: null, location: NOWHERE });
    const id = add();
    await whenIdle();
    expect(getFacts(id)).toMatchObject({ salary: null, workArrangement: null, location: NOWHERE });
    expect(matchOf(id)!.state).toBe('scored');
  });

  it('does not send spoken languages, location preferences, or the CV to the judge', async () => {
    let seen = '';
    stub.judgment = (user) => ((seen = user), JUDGMENT);
    savePreferences(prefs({ locations: ['Copenhagen'], notes: 'No consulting.' }));
    add();
    await whenIdle();
    const input = JSON.parse(seen);
    expect(input.job.requiredSkills).toEqual(FACTS.requiredSkills);
    expect(input.profile.skills).toEqual(PROFILE.skills);
    expect(input.profile).not.toHaveProperty('languages');
    expect(input.preferences).toEqual({ seniority: 'any', minSalary: null, salaryCurrency: 'DKK', wantedTech: [], unwantedTech: [], notes: 'No consulting.' });
  });

  it('excludes a posting in code and makes no judge call for it', async () => {
    savePreferences(prefs({ excludedCompanies: ['Acme'] }));
    const id = add();
    await whenIdle();
    expect(matchOf(id)).toMatchObject({ state: 'excluded', excluded_reason: 'excluded company', total_score: null });
    expect(stub.calls).toMatchObject({ extract: 1, judge: 0 });
    expect(listPostings({}).items).toHaveLength(0);
    expect(listPostings({ showExcluded: true }).items[0]!.match).toMatchObject({ state: 'excluded', excludedReason: 'excluded company' });
  });

  it('gives a low location fit and no exclusion when location is soft and the job is outside', async () => {
    savePreferences(prefs({ locations: ['Aarhus'] }));
    stub.facts = () => facts({ workArrangement: 'onsite' });
    const id = add();
    await whenIdle();
    expect(matchOf(id)).toMatchObject({ state: 'scored', location_score: 0, total_score: 62 });
  });

  it('lowers the total by the penalty when a soft language constraint is violated', async () => {
    stub.facts = () => facts({ requiredLanguages: ['German'] });
    const id = add();
    await whenIdle();
    expect(matchOf(id)).toMatchObject({ state: 'scored', total_score: 77 - SOFT_PENALTY.language });
    expect(getPostingDetail(id)!.match!.softViolations).toEqual([{ kind: 'language', detail: 'German' }]);
  });

  it('keeps postings unscored until a profile exists, and scores them after the CV import', async () => {
    sqlite.prepare('DELETE FROM profile').run();
    const id = add();
    await whenIdle();
    expect(matchOf(id)).toMatchObject({ state: 'waiting', total_score: null });
    expect(stub.calls).toMatchObject({ extract: 1, judge: 0 });
    const { importCv } = await import('../profile/service');
    importCv('Jane Doe. Frontend developer with six years of TypeScript experience.', 'keep');
    await whenIdle();
    expect(matchOf(id)).toMatchObject({ state: 'scored', total_score: 77 });
    expect(stub.calls).toMatchObject({ extract: 1, judge: 1, derive: 1 });
  });

  it('scores a posting without a description from its title, company, and location', async () => {
    let seen = '';
    stub.facts = (user) => ((seen = user), FACTS);
    const id = add({ description: null });
    sqlite.prepare(`UPDATE postings SET lacks_description = 1 WHERE id = ?`).run(id);
    sqlite.prepare(`DELETE FROM tasks`).run();
    rescorePostings([id]);
    await whenIdle();
    expect(seen).toContain('Title: Frontend Developer');
    expect(seen).toContain('No description is available');
    expect(matchOf(id)!.state).toBe('scored');
    expect(listPostings({}).items[0]!.lacksDescription).toBe(true);
  });
});

describe('ranking', () => {
  beforeEach(() => saveProfileEdits(PROFILE));

  it('ranks by total score, then by posted date with the newer posting first, and puts unscored postings last', async () => {
    const byTitle: Record<string, number> = { 'Data Engineer': 90, 'Backend Developer': 60, 'Frontend Developer': 60 };
    stub.judgment = (user) => {
      const score = byTitle[JSON.parse(user).job.title as string]!;
      return { ...JUDGMENT, skillsFit: score, experienceFit: score, preferenceFit: score };
    };
    savePreferences(prefs({ weights: { skills: 1, experience: 1, preferences: 1, location: 0 } }));
    const older = add({ externalId: '1', title: 'Backend Developer', postedAt: '2026-05-01T00:00:00Z' });
    const newer = add({ externalId: '2', title: 'Frontend Developer', postedAt: '2026-05-20T00:00:00Z' });
    const top = add({ externalId: '3', title: 'Data Engineer', postedAt: '2026-04-01T00:00:00Z' });
    await whenIdle();
    setSetting('matching.paused', true);
    const waiting = add({ externalId: '4', title: 'Platform Architect', postedAt: '2026-05-25T00:00:00Z' });
    await whenIdle();
    expect(listPostings({}).items.map((i) => i.id)).toEqual([top, newer, older, waiting]);
    expect(listPostings({ sort: 'newest' }).items.map((i) => i.id)).toEqual([waiting, newer, older, top]);
    expect(listPostings({ minScore: 80 }).items.map((i) => i.id)).toEqual([top]);
  });

  it('puts an excluded posting and a waiting posting after every scored posting', async () => {
    stub.judgment = () => ({ ...JUDGMENT, skillsFit: 5, experienceFit: 5, preferenceFit: 5 });
    savePreferences(prefs({ excludedCompanies: ['Gamma'] }));
    const low = add({ externalId: '1', title: 'Backend Developer', postedAt: '2026-04-01T00:00:00Z' });
    const excluded = add({ externalId: '2', title: 'Data Engineer', company: 'Gamma', postedAt: '2026-05-29T00:00:00Z' });
    await whenIdle();
    setSetting('matching.paused', true);
    const waiting = add({ externalId: '3', title: 'Platform Architect', postedAt: '2026-05-30T00:00:00Z' });
    await whenIdle();
    const items = listPostings({ showExcluded: true }).items;
    expect(items.map((i) => [i.id, i.match?.state])).toEqual([
      [low, 'scored'],
      [waiting, 'waiting'],
      [excluded, 'excluded'],
    ]);
    // The scored posting has a low score, and still ranks before the newer postings without a score.
    expect(items[0]!.match!.totalScore).toBeLessThan(20);
  });
});

describe('rescore planner', () => {
  beforeEach(() => saveProfileEdits(PROFILE));

  async function seed(): Promise<string[]> {
    const ids = [
      add({ externalId: '1' }),
      add({ externalId: '2', title: 'Data Engineer' }),
      add({ externalId: '3', title: 'Backend Developer', company: 'Beta Corp' }),
    ];
    await whenIdle();
    stub.calls.extract = 0;
    stub.calls.judge = 0;
    return ids;
  }

  it('recomputes every total with new weights and makes no model call', async () => {
    const ids = await seed();
    savePreferences(prefs({ weights: { skills: 100, experience: 0, preferences: 0, location: 0 } }));
    expect(getPostingDetail(ids[0]!)!.match).toMatchObject({ stale: true, totalScore: 77 });
    expect(planRescore()).toEqual({ rulesOnly: 3, judge: 0, extract: 0 });
    await whenIdle();
    expect(stub.calls).toMatchObject({ extract: 0, judge: 0 });
    for (const id of ids) expect(matchOf(id)).toMatchObject({ total_score: 80, state: 'scored' });
    expect(getPostingDetail(ids[0]!)!.match!.stale).toBe(false);
    expect(planRescore()).toEqual({ rulesOnly: 0, judge: 0, extract: 0 });
  });

  it('updates the affected postings without a model call when a company is excluded', async () => {
    const ids = await seed();
    savePreferences(prefs({ excludedCompanies: ['Beta Corp'] }));
    planRescore();
    await whenIdle();
    expect(stub.calls).toMatchObject({ extract: 0, judge: 0 });
    expect(matchOf(ids[2]!)).toMatchObject({ state: 'excluded', excluded_reason: 'excluded company' });
    expect(matchOf(ids[0]!)).toMatchObject({ state: 'scored', total_score: 77 });

    // The user removes the company again. The stored judgment is still valid.
    savePreferences(prefs());
    planRescore();
    await whenIdle();
    expect(matchOf(ids[2]!)).toMatchObject({ state: 'scored', total_score: 77, excluded_reason: null });
    expect(stub.calls).toMatchObject({ extract: 0, judge: 0 });
  });

  it('judges each posting again and does not extract again when a skill is added', async () => {
    const ids = await seed();
    saveProfileEdits({ ...PROFILE, skills: [...PROFILE.skills, { name: 'React', level: 'strong', years: 4 }] });
    // The old scores stay in the ranking and are marked as stale.
    expect(listPostings({}).items.map((i) => i.match)).toEqual(ids.map(() => ({ state: 'scored', totalScore: 77, stale: true, excludedReason: null })));
    stub.judgment = () => ({ ...JUDGMENT, skillsFit: 100 });
    expect(planRescore({ dryRun: true })).toEqual({ rulesOnly: 0, judge: 3, extract: 0 });
    expect(tasksOf().filter((t) => t.state === 'pending')).toHaveLength(0);
    expect(planRescore()).toEqual({ rulesOnly: 0, judge: 3, extract: 0 });
    await whenIdle();
    expect(stub.calls).toMatchObject({ extract: 0, judge: 3 });
    expect(matchOf(ids[0]!)).toMatchObject({ total_score: 85, state: 'scored' });
    expect(listPostings({}).items.every((i) => i.match!.stale === false)).toBe(true);
  });

  it('extracts again only when the description changed', async () => {
    const ids = await seed();
    sqlite.prepare('UPDATE postings SET description = ? WHERE id = ?').run('A new and different description. '.repeat(10), ids[0]);
    expect(planRescore()).toEqual({ rulesOnly: 0, judge: 0, extract: 1 });
    await whenIdle();
    expect(stub.calls).toMatchObject({ extract: 1, judge: 1 });
  });

  it('queues a full new judgment for selected postings on request and reuses the facts', async () => {
    const ids = await seed();
    stub.judgment = () => ({ ...JUDGMENT, skillsFit: 0, experienceFit: 0, preferenceFit: 0 });
    expect(rescorePostings([ids[0]!, 'unknown-id'])).toBe(1);
    await whenIdle();
    expect(stub.calls).toMatchObject({ extract: 0, judge: 1 });
    expect(matchOf(ids[0]!)!.total_score).toBe(15);
    expect(matchOf(ids[1]!)!.total_score).toBe(77);
  });

  it('stores the version of the profile and preferences with each score', async () => {
    const [id] = await seed();
    const before = currentVersions()!;
    expect(matchOf(id!)).toMatchObject({ state: 'scored', judge_version: before.judgeVersion, rule_version: before.ruleVersion });
    saveProfileEdits({ ...PROFILE, skills: [...PROFILE.skills, { name: 'Go', level: 'working', years: 1 }] });
    const after = currentVersions()!;
    expect(after.judgeVersion).not.toBe(before.judgeVersion);
    // The stored score keeps the version that it used until a new judgment replaces it.
    expect(matchOf(id!)!.judge_version).toBe(before.judgeVersion);
    planRescore();
    await whenIdle();
    expect(matchOf(id!)!.judge_version).toBe(after.judgeVersion);
  });

  it('shows the stale score while the new judgment waits, and replaces it when the judgment is done', async () => {
    const [id] = await seed();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const original = stub.client.generateObject.bind(stub.client);
    stub.client.generateObject = (async (schema: any, messages: any, opts: any) => {
      if (opts?.name === 'judgment') await gate;
      return original(schema, messages, opts);
    }) as typeof stub.client.generateObject;
    stub.judgment = () => ({ ...JUDGMENT, skillsFit: 100 });
    saveProfileEdits({ ...PROFILE, skills: [...PROFILE.skills, { name: 'React', level: 'strong', years: 4 }] });
    planRescore();
    await new Promise((r) => setTimeout(r, 10));
    try {
      // The new judgment runs and has not returned.
      expect(tasksOf('judge').filter((t) => t.state === 'running').length).toBeGreaterThan(0);
      expect(getPostingDetail(id!)!.match).toMatchObject({ state: 'scored', totalScore: 77, stale: true });
      expect(listPostings({}).items.find((i) => i.id === id)!.match).toMatchObject({ totalScore: 77, stale: true });
    } finally {
      release();
    }
    await whenIdle();
    expect(getPostingDetail(id!)!.match).toMatchObject({ state: 'scored', totalScore: 85, stale: false });
  });
});

describe('states, pause, and failures', () => {
  beforeEach(() => saveProfileEdits(PROFILE));

  it('starts no posting while matching is paused and continues after resume', async () => {
    setSetting('matching.paused', true);
    const id = add();
    await whenIdle();
    expect(matchOf(id)!.state).toBe('waiting');
    expect(stub.calls.extract).toBe(0);
    setSetting('matching.paused', false);
    await whenIdle();
    expect(matchOf(id)!.state).toBe('scored');
  });

  it('finishes the posting in progress when the user pauses', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const original = stub.client.generateObject.bind(stub.client);
    stub.client.generateObject = (async (schema: any, messages: any, opts: any) => {
      if (opts?.name === 'posting_facts') await gate;
      return original(schema, messages, opts);
    }) as typeof stub.client.generateObject;
    const first = add({ externalId: '1' });
    const second = add({ externalId: '2', title: 'Data Engineer' });
    await new Promise((r) => setTimeout(r, 10));
    expect(matchOf(first)!.state).toBe('in_progress');
    setSetting('matching.paused', true);
    release();
    await whenIdle();
    // The extraction that ran is complete. No other step started.
    expect(getFacts(first)).toEqual(FACTS);
    expect(matchOf(first)!.state).toBe('waiting');
    expect(getFacts(second)).toBeNull();
    setSetting('matching.paused', false);
    await whenIdle();
    expect([matchOf(first)!.state, matchOf(second)!.state]).toEqual(['scored', 'scored']);
  });

  it('continues with queued postings after a restart', async () => {
    setSetting('matching.paused', true);
    const id = add();
    await whenIdle();
    sqlite.prepare(`UPDATE tasks SET state = 'running' WHERE subject_id = ?`).run(id);
    setSetting('matching.paused', false);
    await whenIdle();
    expect(matchOf(id)!.state).toBe('waiting');
    recoverRunningTasks();
    await whenIdle();
    expect(matchOf(id)!.state).toBe('scored');
  });

  it('marks a posting as failed with the reason after the retry limit, and continues with the next posting', async () => {
    const clock = fakeClock();
    stub.facts = (user) => {
      if (user.includes('Data Engineer')) throw new InvalidOutputError('model output did not fit the schema after 3 attempts');
      return FACTS;
    };
    const bad = add({ externalId: '1', title: 'Data Engineer' });
    const good = add({ externalId: '2' });
    await whenIdle();
    expect(matchOf(good)!.state).toBe('scored');
    expect(matchOf(bad)!.state).toBe('waiting');
    for (let i = 0; i < 8; i++) {
      clock.advance(10 * 60_000);
      await whenIdle();
    }
    expect(stub.calls.extract).toBe(MAX_ATTEMPTS + 1);
    expect(matchOf(bad)).toMatchObject({ state: 'failed', fail_reason: 'model output did not fit the schema after 3 attempts' });
    expect(getPostingDetail(bad)!.match!.failReason).toContain('did not fit the schema');

    // A manual rescore gives the posting a new chance.
    stub.facts = () => FACTS;
    rescorePostings([bad]);
    await whenIdle();
    expect(matchOf(bad)!.state).toBe('scored');
  });

  it('rejects a judgment with a score outside 0 to 100 and stores no score from it', async () => {
    const clock = fakeClock();
    let judgment: unknown = { ...JUDGMENT, skillsFit: 150 };
    const sent: string[] = [];
    // The real client of the local endpoint validates the answers. Only the HTTP answer is fake.
    const fakeFetch = (async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      const name = body.response_format.json_schema.name as string;
      sent.push(name);
      const content = JSON.stringify(name === 'posting_facts' ? FACTS : judgment);
      return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });
    }) as unknown as typeof fetch;
    setLlmClientForTests(createOpenAiClient({ baseUrl: 'http://llm.test', model: 'm', fetch: fakeFetch }));
    const id = add();
    await whenIdle();
    expect(sent.filter((n) => n === 'judgment')).toHaveLength(3);
    expect(matchOf(id)).toMatchObject({ state: 'waiting', skills_score: null, total_score: null });

    judgment = JUDGMENT;
    clock.advance(10 * 60_000);
    await whenIdle();
    expect(matchOf(id)).toMatchObject({ state: 'scored', skills_score: 80, total_score: 77 });
  });

  it('keeps queued postings in "waiting" while the endpoint is down, and resumes when it returns', async () => {
    stub.facts = () => {
      throw new ProviderUnavailableError('endpoint is down');
    };
    const ids = [add({ externalId: '1' }), add({ externalId: '2', title: 'Data Engineer' })];
    await whenIdle();
    expect(ids.map((id) => matchOf(id)!.state)).toEqual(['waiting', 'waiting']);
    expect(tasksOf('extract').every((t) => t.state === 'pending' && t.attempts === 0)).toBe(true);
    const { isLlmAvailable } = await import('../llm');
    expect(isLlmAvailable()).toBe(false);
    // The status that the interface shows reports the outage.
    setPasswordForTests(undefined);
    const status = await (await createApp().request('/api/status')).json();
    expect(status).toMatchObject({ llmAvailable: false, queueTotal: 2 });
    stub.facts = () => FACTS;
    await probe();
    await whenIdle();
    expect(ids.map((id) => matchOf(id)!.state)).toEqual(['scored', 'scored']);
    expect(isLlmAvailable()).toBe(true);
  });

  it('keeps facts and scores valid when the provider changes, and uses the new provider for later work', async () => {
    const first = add({ externalId: '1' });
    await whenIdle();
    (stub.client as { provider: string }).provider = 'claude-code';
    (stub.client as { model: string }).model = 'claude-haiku-5-5';
    expect(planRescore()).toEqual({ rulesOnly: 0, judge: 0, extract: 0 });
    const second = add({ externalId: '2', title: 'Data Engineer' });
    await whenIdle();
    expect(matchOf(first)).toMatchObject({ provider: 'local', state: 'scored', total_score: 77 });
    expect(getPostingDetail(first)!.match!.stale).toBe(false);
    expect(matchOf(second)).toMatchObject({ provider: 'claude-code', model: 'claude-haiku-5-5' });
  });
});

describe('automatic dismissal', () => {
  beforeEach(() => {
    saveProfileEdits(PROFILE);
    savePreferences(prefs({ autoDismiss: { enabled: true, threshold: 50 } }));
  });
  const low = () => ({ ...JUDGMENT, skillsFit: 10, experienceFit: 10, preferenceFit: 10 });

  it('dismisses a new posting that scores below the threshold and records that the dismissal was automatic', async () => {
    stub.judgment = low;
    const id = add();
    await whenIdle();
    expect(matchOf(id)!.total_score).toBe(24);
    expect(postingOf(id)).toMatchObject({ triage_status: 'dismissed', triage_origin: 'auto' });
    expect(listPostings({ status: 'dismissed' }).items[0]).toMatchObject({ triageStatus: 'dismissed', triageOrigin: 'auto' });
  });

  it('keeps a posting that scores at or above the threshold', async () => {
    const id = add();
    await whenIdle();
    expect(postingOf(id).triage_status).toBe('new');
  });

  it('does nothing while the option is disabled', async () => {
    savePreferences(prefs());
    stub.judgment = low;
    const id = add();
    await whenIdle();
    expect(postingOf(id).triage_status).toBe('new');
    expect(getPreferences().autoDismiss.enabled).toBe(false);
  });

  it('keeps a saved posting that scores low after a rescore', async () => {
    const id = add();
    await whenIdle();
    setTriage(id, 'saved');
    stub.judgment = low;
    rescorePostings([id]);
    await whenIdle();
    expect(matchOf(id)!.total_score).toBe(24);
    expect(postingOf(id).triage_status).toBe('saved');
  });

  it('does not dismiss a posting that the user restored, after a manual rescore', async () => {
    stub.judgment = low;
    const id = add();
    await whenIdle();
    setTriage(id, 'new');
    rescorePostings([id]);
    await whenIdle();
    expect(postingOf(id)).toMatchObject({ triage_status: 'new', triage_origin: 'user' });
  });

  it('does not dismiss an untriaged posting that scores low after a manual rescore', async () => {
    // A posting that scored before and a posting whose first score comes from the manual rescore.
    const clock = fakeClock();
    const scored = add({ externalId: '1' });
    stub.facts = (user) => {
      if (user.includes('Data Engineer')) throw new InvalidOutputError('bad output');
      return FACTS;
    };
    const failed = add({ externalId: '2', title: 'Data Engineer' });
    for (let i = 0; i < 8; i++) {
      await whenIdle();
      clock.advance(10 * 60_000);
    }
    await whenIdle();
    expect(matchOf(failed)!.state).toBe('failed');
    expect(matchOf(scored)).toMatchObject({ state: 'scored', total_score: 77 });
    expect(postingOf(scored).triage_status).toBe('new');

    stub.facts = () => FACTS;
    stub.judgment = low;
    rescorePostings([scored, failed]);
    await whenIdle();
    for (const id of [scored, failed]) {
      expect(matchOf(id)).toMatchObject({ state: 'scored', total_score: 24 });
      expect(postingOf(id)).toMatchObject({ triage_status: 'new', triage_origin: null });
    }
  });
});
