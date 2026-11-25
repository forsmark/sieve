import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { beforeEach, describe, expect, it } from 'vitest';
import { sqlite } from '../kernel/db';
import { publish } from '../kernel/events';
import { getSetting, setSetting } from '../kernel/settings';
import { enqueue, registerHandler, whenIdle } from '../kernel/tasks';
import { ingestPosting } from '../ingestion/ingest';
import { registerCoverLetterHandler } from '../letters/service';
import { registerMatchAnalysisHandler } from '../analysis/service';
import { registerMatchingHandlers } from '../matching/handlers';
import { setNotificationFetchForTests } from '../notifications/service';
import { extractCvText } from '../profile/cv-import';
import { registerDeriveHandler } from '../profile/derive';
import { saveProfileEdits } from '../profile/service';
import { JUDGMENT, PROFILE, fakeClock, postingOf, raw, resetAll, stubLlm, type StubLlm } from '../testing/helpers';
import { DEFAULT_PREFERENCES } from '../../shared/schemas';
import type { SourceAdapter } from '../sources/adapter';
import { startFetchRun } from '../sources/runner';
import { createApp } from './app';
import { SESSION_COOKIE, setPasswordForTests } from './auth';
import { backupIfDue, createBackup, listBackups, setBackupDirForTests } from './backup';

let app: ReturnType<typeof createApp>;
let stub: StubLlm;
let cookie = '';

beforeEach(async () => {
  await resetAll();
  setPasswordForTests(undefined);
  setNotificationFetchForTests(null);
  setBackupDirForTests(mkdtempSync(join(tmpdir(), 'sieve-backup-')));
  stub = stubLlm();
  registerMatchingHandlers();
  registerDeriveHandler();
  registerCoverLetterHandler();
  registerMatchAnalysisHandler();
  app = createApp();
  cookie = '';
});

async function call(method: string, path: string, body?: unknown): Promise<{ status: number; json: any; res: Response }> {
  const res = await app.request(path, {
    method,
    headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  return { status: res.status, json, res };
}

function add(overrides: Parameters<typeof raw>[0] = {}): string {
  const r = ingestPosting('remotive', raw(overrides));
  if (r.status === 'invalid') throw new Error('invalid');
  return r.id;
}

describe('health and live events', () => {
  it('answers the health route', async () => {
    expect(await call('GET', '/api/health')).toMatchObject({ status: 200, json: { ok: true } });
  });

  it('answers unknown API paths with 404 and invalid JSON with 400', async () => {
    expect((await call('GET', '/api/nothing')).status).toBe(404);
    const res = await app.request('/api/search', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: '{broken' });
    expect(res.status).toBe(400);
  });

  it('sends a published event to a connected client', async () => {
    const res = await app.request('/api/events');
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let text = '';
    const readUntil = async (needle: string) => {
      while (!text.includes(needle)) {
        const { value, done } = await reader.read();
        if (done) break;
        text += decoder.decode(value);
      }
    };
    await readUntil('event: ready');
    publish({ type: 'match.updated', postingId: 'p-42' });
    await readUntil('p-42');
    expect(text).toContain('data: {"type":"match.updated","postingId":"p-42"}');
    await reader.cancel();
  });

  it('reports the state of the system', async () => {
    const { json } = await call('GET', '/api/status');
    expect(json).toMatchObject({
      authRequired: false, profileReady: false, hasCv: false, activeRunId: null, queueTotal: 0, matchingPaused: false,
      llmProvider: 'local', searchTermCount: 0, counts: { new: 0, saved: 0, applied: 0, dismissed: 0 },
    });
  });
});

describe('login', () => {
  it('needs no login when no password is set', async () => {
    expect((await call('GET', '/api/auth/me')).json).toEqual({ authRequired: false, authenticated: true });
    expect((await call('GET', '/api/status')).status).toBe(200);
  });

  it('binds to the loopback address only when no password is set', async () => {
    const { config } = await import('../config');
    expect(config.authPassword).toBeNull();
    expect(config.host).toBe('127.0.0.1');
  });

  it('rejects requests without a session, accepts the password, and keeps the session until logout', async () => {
    setPasswordForTests('correct horse');
    expect((await call('GET', '/api/status')).status).toBe(401);
    expect((await call('GET', '/api/health')).status).toBe(200);
    expect((await call('GET', '/api/auth/me')).json).toEqual({ authRequired: true, authenticated: false });
    expect((await call('POST', '/api/auth/login', { password: 'wrong' })).status).toBe(401);

    const login = await call('POST', '/api/auth/login', { password: 'correct horse' });
    expect(login.status).toBe(200);
    const setCookie = login.res.headers.get('set-cookie')!;
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toMatch(/Max-Age=2592000/);
    cookie = setCookie.split(';')[0]!;
    expect(cookie.startsWith(`${SESSION_COOKIE}=`)).toBe(true);
    expect((await call('GET', '/api/status')).status).toBe(200);
    expect((await call('GET', '/api/auth/me')).json.authenticated).toBe(true);

    // The session is a database row with a hash, so it survives a restart of the process.
    const rows = sqlite.prepare('SELECT token_hash FROM sessions').all() as Array<{ token_hash: string }>;
    expect(rows).toHaveLength(1);
    expect(cookie).not.toContain(rows[0]!.token_hash);
    app = createApp();
    expect((await call('GET', '/api/status')).status).toBe(200);

    await call('POST', '/api/auth/logout');
    expect((await call('GET', '/api/status')).status).toBe(401);
  });

  it('expires a session after 30 days', async () => {
    const clock = fakeClock();
    setPasswordForTests('pw');
    const login = await call('POST', '/api/auth/login', { password: 'pw' });
    cookie = login.res.headers.get('set-cookie')!.split(';')[0]!;
    clock.advance(29 * 86_400_000);
    expect((await call('GET', '/api/status')).status).toBe(200);
    clock.advance(2 * 86_400_000);
    expect((await call('GET', '/api/status')).status).toBe(401);
  });

  it('limits login attempts to five in 15 minutes', async () => {
    const clock = fakeClock();
    setPasswordForTests('pw');
    for (let i = 0; i < 5; i++) expect((await call('POST', '/api/auth/login', { password: 'no' })).status).toBe(401);
    expect((await call('POST', '/api/auth/login', { password: 'pw' })).status).toBe(429);
    clock.advance(16 * 60_000);
    expect((await call('POST', '/api/auth/login', { password: 'pw' })).status).toBe(200);
  });
});

describe('sources, search, schedule, and runs', () => {
  it('lists every source with its name, enabled state, inputs, and last result', async () => {
    const { json } = await call('GET', '/api/sources');
    expect(json.map((s: any) => s.id).sort()).toEqual(['arbeitnow', 'jobindex', 'linkedin', 'remoteok', 'remotive']);
    expect(json[0]).toMatchObject({ enabled: true, lastResult: null });
    expect(json.every((s: any) => typeof s.supports.keywords === 'boolean' && s.name)).toBe(true);

    sqlite.prepare(`INSERT INTO fetch_runs (trigger, state, started_at, ended_at) VALUES ('manual', 'completed', '2026-05-01T00:00:00.000Z', '2026-05-01T00:01:00.000Z')`).run();
    sqlite.prepare(`INSERT INTO fetch_run_sources (run_id, source, state, found, added, invalid, error) VALUES (1, 'jobindex', 'failed', 4, 2, 1, 'HTTP 500')`).run();
    const after = (await call('GET', '/api/sources')).json.find((s: any) => s.id === 'jobindex');
    expect(after.lastResult).toEqual({ source: 'jobindex', state: 'failed', found: 4, added: 2, invalid: 1, error: 'HTTP 500' });
    expect(after.lastRunAt).toBe('2026-05-01T00:00:00.000Z');
  });

  it('disables and enables a source', async () => {
    const off = await call('PATCH', '/api/sources/linkedin', { enabled: false });
    expect(off.json.find((s: any) => s.id === 'linkedin').enabled).toBe(false);
    expect(getSetting('sources.disabled')).toEqual(['linkedin']);
    await call('PATCH', '/api/sources/linkedin', { enabled: true });
    expect(getSetting('sources.disabled')).toEqual([]);
    expect((await call('PATCH', '/api/sources/nope', { enabled: false })).status).toBe(404);
  });

  it('stores the search terms and the region', async () => {
    const saved = await call('PUT', '/api/search', { terms: [' react ', '', 'react', 'vue'], region: ' Copenhagen ' });
    expect(saved.json).toEqual({ terms: ['react', 'vue'], region: 'Copenhagen' });
    expect((await call('GET', '/api/search')).json).toEqual({ terms: ['react', 'vue'], region: 'Copenhagen' });
    expect((await call('GET', '/api/status')).json.searchTermCount).toBe(2);
    expect((await call('PUT', '/api/search', { terms: 'react' })).status).toBe(400);
  });

  it('stores the schedule', async () => {
    expect((await call('GET', '/api/schedule')).json).toMatchObject({ intervalHours: 4, paused: false });
    expect((await call('PUT', '/api/schedule', { intervalHours: 8, paused: true })).json).toMatchObject({ intervalHours: 8, paused: true });
    expect((await call('PUT', '/api/schedule', { intervalHours: 0 })).status).toBe(400);
  });

  it('starts a manual run and records it', async () => {
    // Every source is disabled, so the run makes no network request.
    setSetting('sources.disabled', ['arbeitnow', 'jobindex', 'linkedin', 'remoteok', 'remotive']);
    expect((await call('POST', '/api/fetch')).json).toEqual({ started: true, runId: 1 });
    await new Promise((r) => setTimeout(r, 20));
    const runs = (await call('GET', '/api/runs')).json;
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ id: 1, trigger: 'manual', state: 'completed' });
    expect(runs[0].sources).toHaveLength(5);
    expect(runs[0].sources.every((s: any) => s.state === 'skipped')).toBe(true);
    expect((await call('GET', '/api/status')).json.activeRunId).toBeNull();
  });

  it('shows an active run and starts no second run on request', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const slow: SourceAdapter = {
      id: 'slow', name: 'Slow', supports: { keywords: false, region: false }, rate: { minDelayMs: 0, maxConcurrent: 1 },
      async *search() {
        await gate;
      },
    };
    const run = startFetchRun('manual', { adapters: [slow] })!;
    expect((await call('GET', '/api/status')).json.activeRunId).toBe(run.runId);
    expect((await call('POST', '/api/fetch')).json).toEqual({ started: false, runId: run.runId });
    expect((await call('GET', '/api/runs')).json[0]).toMatchObject({ state: 'running', sources: [{ source: 'slow', state: 'running' }] });
    release();
    await run.done;
    expect((await call('GET', '/api/runs')).json).toHaveLength(1);
  });
});

describe('profile and preferences', () => {
  const CV = 'Jane Doe. Frontend developer with six years of TypeScript and React experience.';

  it('imports pasted CV text and derives the profile', async () => {
    const res = await call('POST', '/api/profile/cv', { text: CV });
    expect(res.json).toMatchObject({ hasCv: true, deriveState: 'pending' });
    await whenIdle();
    const profile = (await call('GET', '/api/profile')).json;
    expect(profile).toMatchObject({ hasCv: true, deriveState: 'idle', effective: PROFILE, cvText: CV });
    expect((await call('GET', '/api/status')).json).toMatchObject({ profileReady: true, hasCv: true });
  });

  it('imports an uploaded Markdown file', async () => {
    const form = new FormData();
    form.set('file', new File([`# CV\n\n${CV}`], 'cv.md', { type: 'text/markdown' }));
    const res = await app.request('/api/profile/cv', { method: 'POST', body: form });
    expect(res.status).toBe(200);
    expect((await res.json()).cvText).toContain('Frontend developer');
  });

  it('extracts the text of an uploaded text-based PDF and stores it as the current CV', async () => {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    doc.addPage([595, 842]).drawText(CV, { x: 40, y: 780, size: 9, font });
    const form = new FormData();
    form.set('file', new File([new Uint8Array(await doc.save())], 'cv.pdf', { type: 'application/pdf' }));
    const res = await app.request('/api/profile/cv', { method: 'POST', body: form });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.hasCv).toBe(true);
    expect(body.cvText).toContain(CV);
    const stored = (await call('GET', '/api/profile')).json;
    expect(stored.hasCv).toBe(true);
    expect(stored.cvText).toContain(CV);
  });

  it('rejects a file without readable text with an explanation', async () => {
    const form = new FormData();
    form.set('file', new File([new Uint8Array([0, 1, 2, 3, 0, 0])], 'scan.bin'));
    const res = await app.request('/api/profile/cv', { method: 'POST', body: form });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/text/);
    expect((await call('POST', '/api/profile/cv', { text: '  ' })).status).toBe(400);
    expect((await call('GET', '/api/profile')).json.hasCv).toBe(false);
  });

  it('stores profile edits and reports the rescore work', async () => {
    saveProfileEdits(PROFILE);
    add();
    await whenIdle();
    const res = await call('PUT', '/api/profile', { ...PROFILE, skills: [{ name: 'TypeScript', level: 'expert', years: 6 }] });
    expect(res.json.profile.effective.skills[0].level).toBe('expert');
    expect(res.json.plan).toEqual({ rulesOnly: 0, judge: 1, extract: 0 });
    expect((await call('PUT', '/api/profile', { headline: 1 })).status).toBe(400);
  });

  it('reports the cost of a preference change in a dry run and stores nothing', async () => {
    saveProfileEdits(PROFILE);
    add();
    add({ externalId: 'job-2', title: 'Data Engineer' });
    await whenIdle();
    stub.calls.judge = 0;
    const weights = { ...DEFAULT_PREFERENCES, weights: { skills: 70, experience: 10, preferences: 10, location: 10 } };
    const dry = await call('PUT', '/api/preferences?dryRun=1', weights);
    expect(dry.json.plan).toEqual({ rulesOnly: 2, judge: 0, extract: 0 });
    expect((await call('GET', '/api/preferences')).json.weights).toEqual(DEFAULT_PREFERENCES.weights);
    expect((await call('GET', '/api/status')).json.queueTotal).toBe(0);

    const notes = await call('PUT', '/api/preferences?dryRun=1', { ...DEFAULT_PREFERENCES, notes: 'No consulting.' });
    expect(notes.json.plan).toEqual({ rulesOnly: 0, judge: 2, extract: 0 });

    const saved = await call('PUT', '/api/preferences', weights);
    expect(saved.json.plan).toEqual({ rulesOnly: 2, judge: 0, extract: 0 });
    await whenIdle();
    expect(stub.calls.judge).toBe(0);
    expect((await call('GET', '/api/matching/stale')).json).toEqual({ rulesOnly: 0, judge: 0, extract: 0 });
  });

  it('rejects a negative minimum salary and keeps the earlier preferences', async () => {
    await call('PUT', '/api/preferences', { ...DEFAULT_PREFERENCES, minSalary: 45000 });
    const res = await call('PUT', '/api/preferences', { ...DEFAULT_PREFERENCES, minSalary: -5 });
    expect(res.status).toBe(400);
    expect(res.json.error).toContain('minSalary');
    expect((await call('GET', '/api/preferences')).json.minSalary).toBe(45000);
  });
});

describe('postings', () => {
  beforeEach(() => saveProfileEdits(PROFILE));

  it('returns the ranked list with paging, the detail, and the queue status', async () => {
    const scores: Record<string, number> = { 'Data Engineer': 90, 'Backend Developer': 50, 'Frontend Developer': 50 };
    stub.judgment = (user) => {
      const s = scores[JSON.parse(user).job.title as string]!;
      return { ...JUDGMENT, skillsFit: s, experienceFit: s, preferenceFit: s };
    };
    const older = add({ externalId: '1', title: 'Backend Developer', postedAt: '2026-05-01T00:00:00Z' });
    const newer = add({ externalId: '2', title: 'Frontend Developer', postedAt: '2026-05-20T00:00:00Z' });
    const top = add({ externalId: '3', title: 'Data Engineer', postedAt: '2026-04-01T00:00:00Z' });
    expect((await call('GET', '/api/status')).json.queue).toEqual({ extract: 3 });
    await whenIdle();
    // A saved posting stays in the default list and ranks by its score among the new ones.
    expect((await call('PATCH', `/api/postings/${top}`, { action: 'save' })).status).toBe(200);

    const page1 = (await call('GET', '/api/postings?limit=2')).json;
    expect(page1.total).toBe(3);
    expect(page1.items.map((i: any) => i.id)).toEqual([top, newer]);
    expect(page1.nextOffset).toBe(2);
    const page2 = (await call('GET', `/api/postings?limit=2&offset=${page1.nextOffset}`)).json;
    expect(page2.items.map((i: any) => i.id)).toEqual([older]);
    expect(page2.nextOffset).toBeNull();

    const detail = (await call('GET', `/api/postings/${top}`)).json;
    expect(detail.match).toMatchObject({ state: 'scored', matchedSkills: ['TypeScript'], missingSkills: ['React'], assessment: JUDGMENT.assessment });
    expect(detail.facts.requiredSkills).toEqual(['TypeScript', 'React']);
    expect(detail.sourceLinks).toEqual([{ id: top, source: 'remotive', url: 'https://jobs.test/job-1', primary: true }]);
    expect((await call('GET', '/api/postings/nope')).status).toBe(404);
  });

  it('filters by text, source, work arrangement, tag, age, and unread state', async () => {
    const clock = fakeClock(Date.parse('2026-06-01T00:00:00Z'));
    stub.facts = (user) => ({
      ...JSON.parse(JSON.stringify({ requiredSkills: user.includes('Rust') ? ['Rust'] : ['TypeScript'], optionalSkills: [], seniority: null })),
      workArrangement: user.includes('Rust') ? 'remote' : 'onsite',
      location: { city: null, country: null }, requiredLanguages: [], salary: null, summary: 's',
    });
    const a = add({ externalId: '1', title: 'Rust Systems Engineer', company: 'Ferrous', postedAt: '2026-05-30T00:00:00Z' });
    const b = add({ externalId: '2', title: 'Web Developer', company: '100% Web', postedAt: '2026-03-01T00:00:00Z' });
    const dup = ingestPosting('linkedin', raw({ externalId: 'li', title: 'Web Developer', company: '100% Web', url: 'https://li.test/1' }));
    await whenIdle();
    const ids = async (query: string) => (await call('GET', `/api/postings?${query}`)).json.items.map((i: any) => i.id);

    expect(await ids('q=rust')).toEqual([a]);
    expect(await ids('q=100%25')).toEqual([b]);
    expect(await ids('q=nothing')).toEqual([]);
    expect(await ids('source=linkedin')).toEqual([b]);
    expect(await ids('work=remote')).toEqual([a]);
    expect(await ids('tag=rust')).toEqual([a]);
    expect(await ids('maxAgeDays=7')).toEqual([a]);
    expect((await ids('showDuplicates=1')).length).toBe(3);

    const item = (await call('GET', '/api/postings?source=linkedin')).json.items[0];
    expect(item.sources).toEqual(['remotive', 'linkedin']);
    expect(item.tags).toEqual(['TypeScript']);
    const detail = (await call('GET', `/api/postings/${b}`)).json;
    expect(detail.sourceLinks[1]).toMatchObject({ source: 'linkedin', url: 'https://li.test/1', primary: false });

    await call('PATCH', `/api/postings/${a}`, { read: true });
    expect(await ids('unread=1')).toEqual([b]);
    expect((await call('GET', '/api/status')).json.counts).toMatchObject({ new: 2, unread: 1 });
    clock.advance(0);
    expect(dup.status).toBe('duplicate');
  });

  it('returns only the postings that meet both the work arrangement filter and the minimum score', async () => {
    const titleOf = (user: string) => ['Remote Low', 'Onsite High', 'Remote High'].find((t) => user.includes(t))!;
    stub.facts = (user) => ({
      requiredSkills: ['TypeScript'], optionalSkills: [], seniority: null, workArrangement: titleOf(user).startsWith('Remote') ? 'remote' : 'onsite',
      location: { city: null, country: null }, requiredLanguages: [], salary: null, summary: 's',
    });
    stub.judgment = (user) => {
      const s = titleOf(user).endsWith('High') ? 95 : 30;
      return { ...JUDGMENT, skillsFit: s, experienceFit: s, preferenceFit: s };
    };
    const remoteLow = add({ externalId: '1', title: 'Remote Low', company: 'One' });
    const onsiteHigh = add({ externalId: '2', title: 'Onsite High', company: 'Two' });
    const remoteHigh = add({ externalId: '3', title: 'Remote High', company: 'Three' });
    await whenIdle();

    // The setup holds: each filter alone lets a second posting through.
    const all = (await call('GET', '/api/postings')).json.items as Array<{ id: string; workArrangement: string; match: { totalScore: number } }>;
    const byId = new Map(all.map((i) => [i.id, i]));
    expect(all).toHaveLength(3);
    expect(byId.get(remoteLow)).toMatchObject({ workArrangement: 'remote' });
    expect(byId.get(remoteLow)!.match.totalScore).toBeLessThan(70);
    expect(byId.get(onsiteHigh)).toMatchObject({ workArrangement: 'onsite' });
    expect(byId.get(onsiteHigh)!.match.totalScore).toBeGreaterThanOrEqual(70);
    const ids = async (query: string) => (await call('GET', `/api/postings?${query}`)).json.items.map((i: any) => i.id);
    expect((await ids('work=remote')).sort()).toEqual([remoteLow, remoteHigh].sort());
    expect((await ids('minScore=70')).sort()).toEqual([onsiteHigh, remoteHigh].sort());

    const both = (await call('GET', '/api/postings?work=remote&minScore=70')).json;
    expect(both.items.map((i: any) => i.id)).toEqual([remoteHigh]);
    expect(both.total).toBe(1);
  });

  it('applies triage actions and restores the earlier statuses for undo', async () => {
    const a = add({ externalId: '1' });
    const b = add({ externalId: '2', title: 'Data Engineer' });
    await whenIdle();
    const saved = await call('PATCH', `/api/postings/${a}`, { action: 'save' });
    expect(saved.json.previous).toEqual([{ id: a, triageStatus: 'new' }]);
    expect(saved.json.posting.triageStatus).toBe('saved');

    const bulk = await call('POST', '/api/postings/bulk', { ids: [a, b], action: 'dismiss' });
    expect(bulk.json.previous).toEqual([{ id: a, triageStatus: 'saved' }, { id: b, triageStatus: 'new' }]);
    expect((await call('GET', '/api/postings')).json.items).toHaveLength(0);
    expect((await call('GET', '/api/postings?status=dismissed')).json.items).toHaveLength(2);
    expect((await call('GET', '/api/postings?status=all')).json.items).toHaveLength(2);

    await call('POST', '/api/postings/restore', { previous: bulk.json.previous });
    expect(postingOf(a).triage_status).toBe('saved');
    expect(postingOf(b).triage_status).toBe('new');

    await call('POST', '/api/postings/bulk', { ids: [a, b], action: 'read' });
    expect((await call('GET', '/api/postings?unread=1')).json.items).toHaveLength(0);
    expect((await call('POST', '/api/postings/bulk', { ids: [], action: 'save' })).status).toBe(400);
  });

  it('rescoring and duplicate separation work through the API', async () => {
    const a = add();
    const dup = ingestPosting('linkedin', raw({ externalId: 'li' }));
    await whenIdle();
    stub.calls.judge = 0;
    expect((await call('POST', `/api/postings/${a}/rescore`)).json).toEqual({ queued: 1 });
    await whenIdle();
    expect(stub.calls.judge).toBe(1);
    expect((await call('POST', '/api/postings/bulk', { ids: [a], action: 'rescore' })).json.queued).toBe(1);
    await whenIdle();
    expect(stub.calls.judge).toBe(2);

    if (dup.status !== 'duplicate') throw new Error('expected a duplicate');
    const separated = await call('POST', `/api/postings/${dup.id}/separate`);
    expect(separated.json).toMatchObject({ id: dup.id, duplicateOf: null });
    await whenIdle();
    const listed = (await call('GET', '/api/postings')).json.items;
    expect(listed).toHaveLength(2);
    // The separated posting is its own row in the default list, and the system scored it.
    expect(listed.map((i: any) => i.id).sort()).toEqual([a, dup.id].sort());
    expect(listed.find((i: any) => i.id === dup.id).match).toMatchObject({ state: 'scored' });
    const detail = (await call('GET', `/api/postings/${dup.id}`)).json;
    expect(detail.match.state).toBe('scored');
    expect(typeof detail.match.totalScore).toBe('number');
    expect((await call('POST', `/api/postings/${a}/separate`)).status).toBe(400);
  });

  it('pauses and resumes matching', async () => {
    expect((await call('POST', '/api/matching/pause')).json).toEqual({ paused: true });
    add();
    await whenIdle();
    expect((await call('GET', '/api/status')).json).toMatchObject({ matchingPaused: true, queueTotal: 1 });
    await call('POST', '/api/matching/resume');
    await whenIdle();
    expect((await call('GET', '/api/status')).json).toMatchObject({ matchingPaused: false, queueTotal: 0 });
  });
});

describe('language model and notification settings', () => {
  it('returns the settings and tests the provider', async () => {
    expect((await call('GET', '/api/llm')).json.settings).toMatchObject({ provider: 'local', claudeModel: 'claude-haiku-5-5', claudeEffort: 'low' });
    expect((await call('POST', '/api/llm/test')).json).toMatchObject({ reachable: true });
    stub.healthResult = { reachable: false, modelAvailable: false, detail: 'connection refused' };
    expect((await call('POST', '/api/llm/test')).json).toEqual({ reachable: false, modelAvailable: false, detail: 'connection refused' });
    expect((await call('GET', '/api/status')).json.llmAvailable).toBe(false);
  });

  it('saves a provider that responds and refuses a change to one that does not', async () => {
    const next = { ...getSetting('llm'), provider: 'claude-code', claudeEffort: 'medium' };
    const ok = await call('PUT', '/api/llm', next);
    expect(ok.status).toBe(200);
    expect(ok.json).toMatchObject({ saved: true, settings: { provider: 'claude-code', claudeEffort: 'medium' } });

    stub.healthResult = { reachable: false, modelAvailable: false, detail: 'endpoint is unreachable' };
    const bad = await call('PUT', '/api/llm', { ...next, provider: 'local' });
    expect(bad.status).toBe(400);
    expect(bad.json).toMatchObject({ saved: false, health: { detail: 'endpoint is unreachable' } });
    expect(getSetting('llm').provider).toBe('claude-code');
    expect((await call('PUT', '/api/llm', { ...next, claudeEffort: 'high' })).status).toBe(400);
  });

  it('enables notifications, shows the subscribe link, regenerates the topic, and sends a test', async () => {
    const calls: string[] = [];
    setNotificationFetchForTests((async (url: string) => {
      calls.push(String(url));
      return new Response('{}');
    }) as typeof fetch);
    expect((await call('GET', '/api/notifications')).json).toMatchObject({ enabled: false, topic: null, subscribeUrl: null, threshold: 80 });
    expect((await call('POST', '/api/notifications/test')).status).toBe(502);

    const on = (await call('PUT', '/api/notifications', { enabled: true, threshold: 75, appBaseUrl: 'https://jobs.example.test/' })).json;
    expect(on.topic).toMatch(/^sieve-[a-z2-7]{24}$/);
    expect(on).toMatchObject({ subscribeUrl: `https://ntfy.sh/${on.topic}`, threshold: 75, appBaseUrl: 'https://jobs.example.test' });

    const regenerated = (await call('POST', '/api/notifications/regenerate')).json;
    expect(regenerated.topic).not.toBe(on.topic);
    expect((await call('POST', '/api/notifications/test')).json).toEqual({ ok: true });
    expect(calls).toEqual([`https://ntfy.sh/${regenerated.topic}`]);
    expect((await call('PUT', '/api/notifications', { server: 'not a url' })).status).toBe(400);
  });
});

describe('applications', () => {
  beforeEach(() => saveProfileEdits(PROFILE));

  it('creates one application with a copy of the posting, also when the user applies twice', async () => {
    const clock = fakeClock();
    const id = add();
    await whenIdle();
    const first = await call('PATCH', `/api/postings/${id}`, { action: 'apply' });
    expect(first.json.posting).toMatchObject({ triageStatus: 'applied', application: { stage: 'applied', appliedAt: new Date(clock.now()).toISOString() } });
    clock.advance(60_000);
    await call('PATCH', `/api/postings/${id}`, { action: 'apply' });
    expect((await call('POST', '/api/applications', { postingId: id })).status).toBe(200);
    const list = (await call('GET', '/api/applications')).json;
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ postingId: id, stage: 'applied', appliedAt: new Date(clock.now() - 60_000).toISOString(), totalScore: 77 });
    expect(list[0].snapshot).toMatchObject({ title: 'Frontend Developer', company: 'Acme A/S', url: 'https://jobs.test/job-1' });
    expect(list[0].snapshot.facts.requiredSkills).toEqual(['TypeScript', 'React']);
    expect((await call('GET', `/api/applications/${id}/events`)).json).toHaveLength(1);
    expect((await call('POST', '/api/applications', { postingId: 'nope' })).status).toBe(404);
  });

  it('moves an application between stages and records each change in time order', async () => {
    const clock = fakeClock();
    const id = add();
    await call('POST', '/api/applications', { postingId: id });
    clock.advance(1000);
    expect((await call('PATCH', `/api/applications/${id}`, { stage: 'interview' })).json.stage).toBe('interview');
    clock.advance(1000);
    await call('PATCH', `/api/applications/${id}`, { stage: 'offer' });
    // A reload shows the stored stage.
    expect((await call('GET', '/api/applications')).json[0].stage).toBe('offer');
    const events = (await call('GET', `/api/applications/${id}/events`)).json;
    expect(events.map((e: any) => [e.fromStage, e.toStage])).toEqual([[null, 'applied'], ['applied', 'interview'], ['interview', 'offer']]);
    expect(events[1].createdAt < events[2].createdAt).toBe(true);
    // The same stage again adds no history entry.
    await call('PATCH', `/api/applications/${id}`, { stage: 'offer' });
    expect((await call('GET', `/api/applications/${id}/events`)).json).toHaveLength(3);
    expect((await call('PATCH', `/api/applications/${id}`, { stage: 'hired' })).status).toBe(400);
    expect((await call('PATCH', '/api/applications/nope', { stage: 'offer' })).status).toBe(404);
  });

  it('stores notes and the interview date', async () => {
    const id = add();
    await call('POST', '/api/applications', { postingId: id });
    const res = await call('PATCH', `/api/applications/${id}`, { notes: 'Call with Mia.', interviewAt: '2026-07-01T09:30:00+02:00' });
    expect(res.json).toMatchObject({ notes: 'Call with Mia.', interviewAt: '2026-07-01T07:30:00.000Z', stage: 'applied' });
    expect((await call('PATCH', `/api/applications/${id}`, { interviewAt: 'someday' })).status).toBe(400);
    expect((await call('PATCH', `/api/applications/${id}`, { interviewAt: null })).json.interviewAt).toBeNull();
  });

  it('still shows the full description from the copy when the link expired', async () => {
    const id = add();
    await call('POST', '/api/applications', { postingId: id });
    sqlite.prepare(`UPDATE postings SET link_status = 'expired', description = NULL WHERE id = ?`).run(id);
    const [application] = (await call('GET', '/api/applications')).json;
    expect(application.linkStatus).toBe('expired');
    expect(application.snapshot.description).toContain('This role needs TypeScript and React.');
  });

  it('deletes the application and its history, and returns the posting to "saved"', async () => {
    const id = add();
    await call('POST', '/api/applications', { postingId: id });
    await call('PATCH', `/api/applications/${id}`, { stage: 'interview' });
    expect((await call('DELETE', `/api/applications/${id}`)).status).toBe(200);
    expect((await call('GET', '/api/applications')).json).toEqual([]);
    expect(sqlite.prepare('SELECT COUNT(*) AS n FROM application_events').get()).toEqual({ n: 0 });
    expect((await call('GET', '/api/postings?status=saved')).json.items.map((i: any) => i.id)).toEqual([id]);
    expect((await call('DELETE', `/api/applications/${id}`)).status).toBe(404);
  });

  it('keeps the application, its notes, and its history when a triage action hits an applied posting', async () => {
    const id = add();
    await call('POST', '/api/applications', { postingId: id });
    await call('PATCH', `/api/applications/${id}`, { stage: 'interview', notes: 'Keep me.' });
    const bulk = await call('POST', '/api/postings/bulk', { ids: [id], action: 'dismiss' });
    expect(bulk.json.previous).toEqual([]);
    expect(postingOf(id).triage_status).toBe('applied');
    expect((await call('GET', '/api/applications')).json[0]).toMatchObject({ stage: 'interview', notes: 'Keep me.' });
  });

  it('removes the application when an undo returns the posting to its earlier status', async () => {
    const id = add();
    const applied = await call('PATCH', `/api/postings/${id}`, { action: 'apply' });
    await call('POST', '/api/postings/restore', { previous: applied.json.previous });
    expect(postingOf(id).triage_status).toBe('new');
    expect((await call('GET', '/api/applications')).json).toEqual([]);
  });
});

describe('activity and backups', () => {
  it('lists failed tasks and retries one on request', async () => {
    const clock = fakeClock();
    let fail = true;
    registerHandler('liveness', async () => {
      if (fail) throw new Error('link check broke');
    });
    const id = add();
    enqueue('liveness', id);
    for (let i = 0; i < 8; i++) {
      await whenIdle();
      clock.advance(10 * 60_000);
    }
    const activity = (await call('GET', '/api/activity')).json;
    expect(activity.failedTasks).toHaveLength(1);
    expect(activity.failedTasks[0]).toMatchObject({ kind: 'liveness', subjectId: id, subjectTitle: 'Frontend Developer', attempts: 4, lastError: 'link check broke' });
    const errors = (await call('GET', '/api/logs?level=error')).json;
    expect(errors[0].message).toContain('link check broke');
    expect((await call('GET', '/api/logs')).json.length).toBeGreaterThanOrEqual(1);

    fail = false;
    expect((await call('POST', `/api/activity/tasks/${activity.failedTasks[0].id}/retry`)).status).toBe(200);
    await whenIdle();
    expect((await call('GET', '/api/activity')).json.failedTasks).toHaveLength(0);
    expect((await call('POST', `/api/activity/tasks/${activity.failedTasks[0].id}/retry`)).status).toBe(400);
  });

  it('creates a backup that downloads as a valid database with the stored data', async () => {
    const id = add();
    const created = await call('POST', '/api/backups');
    expect(created.json.name).toMatch(/^sieve-\d{8}-\d{6}\.db$/);
    expect((await call('GET', '/api/backups')).json.backups).toHaveLength(1);

    const res = await app.request(`/api/backups/${created.json.name}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-disposition')).toContain(created.json.name);
    const file = join(mkdtempSync(join(tmpdir(), 'sieve-download-')), 'copy.db');
    writeFileSync(file, new Uint8Array(await res.arrayBuffer()));
    const copy = new Database(file, { readonly: true });
    expect(copy.pragma('integrity_check', { simple: true })).toBe('ok');
    expect(copy.prepare('SELECT id, title FROM postings').all()).toEqual([{ id, title: 'Frontend Developer' }]);
    copy.close();

    expect((await call('GET', '/api/backups/..%2F..%2Fetc%2Fpasswd')).status).toBe(404);
    expect((await call('GET', '/api/backups/sieve-20200101-000000.db')).status).toBe(404);
  });

  it('creates scheduled backups at the interval and keeps only the newest ones', async () => {
    const clock = fakeClock();
    setSetting('backup', { intervalHours: 6, keep: 3, lastAt: null });
    expect(await backupIfDue()).toBe(true);
    expect(await backupIfDue()).toBe(false);
    clock.advance(5 * 3_600_000);
    expect(await backupIfDue()).toBe(false);
    for (let i = 0; i < 4; i++) {
      clock.advance(6 * 3_600_000);
      expect(await backupIfDue()).toBe(true);
    }
    const names = listBackups().map((b) => b.name);
    expect(names).toHaveLength(3);
    const newest = await createBackup();
    expect(listBackups()[0]!.name).toBe(newest.name);
    expect(listBackups()).toHaveLength(3);
    expect(listBackups().map((b) => b.name)).not.toContain(names[2]);
  });
});

describe('clear postings', () => {
  beforeEach(() => saveProfileEdits(PROFILE));

  it('reports the counts, deletes the postings without an application, and names the backup it made', async () => {
    const applied = add({ externalId: 'applied', url: 'https://jobs.test/applied', title: 'Backend Developer', company: 'Beta' });
    const saved = add({ externalId: 'saved', url: 'https://jobs.test/saved', title: 'Data Engineer', company: 'Gamma' });
    const fresh = add({ externalId: 'fresh', url: 'https://jobs.test/fresh', title: 'Product Designer', company: 'Delta' });
    await whenIdle();
    await call('PATCH', `/api/postings/${applied}`, { action: 'apply' });
    await call('PATCH', `/api/postings/${saved}`, { action: 'save' });

    expect((await call('GET', '/api/postings/clear')).json).toEqual({ delete: 2, keep: 1, withApplication: 1, saved: 1 });
    expect((await call('POST', '/api/postings/clear')).status).toBe(400);
    expect(await call('POST', '/api/postings/clear', { delete: 2, saved: 0 })).toMatchObject({
      status: 409,
      json: { error: 'The postings changed after the page counted them. Check the new counts and delete again.' },
    });
    const cleared = await call('POST', '/api/postings/clear', { delete: 2, saved: 1 });

    expect(cleared.status).toBe(200);
    expect(cleared.json).toEqual({ deleted: 2, kept: 1, backup: expect.stringMatching(/^sieve-\d{8}-\d{6}\.db$/) });
    expect((await call('GET', '/api/backups')).json.backups.map((b: { name: string }) => b.name)).toEqual([cleared.json.backup]);
    expect((await call('GET', '/api/postings/clear')).json).toEqual({ delete: 0, keep: 1, withApplication: 1, saved: 0 });
    expect((await call('GET', `/api/postings/${saved}`)).status).toBe(404);
    expect((await call('GET', `/api/postings/${fresh}`)).status).toBe(404);
    expect((await call('GET', `/api/postings/${applied}`)).json).toMatchObject({ triageStatus: 'applied' });
    expect((await call('GET', '/api/applications')).json).toHaveLength(1);
  });

  it('refuses with 409 and deletes nothing while a fetch run is active', async () => {
    const id = add();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const slow: SourceAdapter = {
      id: 'slow', name: 'Slow', supports: { keywords: false, region: false }, rate: { minDelayMs: 0, maxConcurrent: 1 },
      async *search() {
        await gate;
      },
    };
    const run = startFetchRun('manual', { adapters: [slow] })!;

    const refused = await call('POST', '/api/postings/clear', { delete: 1, saved: 0 });

    expect(refused).toMatchObject({ status: 409, json: { error: 'A fetch is running. Delete the postings when it ends.' } });
    expect((await call('GET', `/api/postings/${id}`)).status).toBe(200);
    release();
    await run.done;
  });
});

describe('expanded match analysis', () => {
  const CV = `Jane Doe\nSenior developer with eight years of TypeScript and React.\n${'Built web applications for logistics companies. '.repeat(8)}`;

  async function withCv(): Promise<void> {
    await call('POST', '/api/profile/cv', { text: CV, edits: 'keep' });
    await whenIdle();
  }

  it('refuses an analysis before a CV exists, and for an unknown posting', async () => {
    const id = add();
    const refused = await call('POST', `/api/postings/${id}/analysis`);
    expect(refused.status).toBe(400);
    expect(refused.json.error).toBe('Import a CV first. The analysis compares the posting with your CV.');
    await withCv();
    expect((await call('POST', '/api/postings/nope/analysis')).status).toBe(404);
    expect(stub.calls.analysis).toBe(0);
  });

  it('analyzes one posting from the posting, the CV, the preferences, and the earlier score', async () => {
    await withCv();
    const id = add({ title: 'Frontend Engineer', company: 'Acme' });
    await whenIdle();
    const started = await call('POST', `/api/postings/${id}/analysis`);
    expect(started.status).toBe(202);
    expect(started.json).toMatchObject({ state: 'pending', content: null });
    await whenIdle();
    expect(stub.calls.analysis).toBe(1);
    expect(stub.lastAnalysisInput).toContain('Frontend Engineer');
    expect(stub.lastAnalysisInput).toContain('Jane Doe');
    expect(stub.lastAnalysisInput).toContain('STRUCTURED PROFILE');
    expect(stub.lastAnalysisInput).toContain(PROFILE.headline);
    expect(stub.lastAnalysisInput).toContain('CANDIDATE PREFERENCES');
    expect(stub.lastAnalysisInput).toContain('EARLIER SCORE');
    expect(stub.lastAnalysisInput).toContain(JUDGMENT.assessment);
    const detail = (await call('GET', `/api/postings/${id}`)).json;
    expect(detail.matchAnalysis).toMatchObject({ state: 'ready', error: null, model: 'stub-model' });
    expect(detail.matchAnalysis.content).toMatchObject({ verdict: 'consider', unknowns: ['What is the salary range?'] });
    // The card gets the state and the verdict.
    const list = (await call('GET', '/api/postings')).json;
    expect(list.items.find((i: { id: string }) => i.id === id).analysis).toEqual({ state: 'ready', verdict: 'consider' });
  });

  it('queues the selected postings once each with the bulk action, and refuses more than 20', async () => {
    await withCv();
    const a = add({ externalId: 'a1', title: 'Role A', company: 'Alpha', url: 'https://jobs.test/a1' });
    const b = add({ externalId: 'b1', title: 'Role B', company: 'Beta', url: 'https://jobs.test/b1' });
    await whenIdle();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const original = stub.client.generateObject.bind(stub.client);
    stub.client.generateObject = (async (schema: any, messages: any, opts: any) => {
      if (opts?.name === 'match_analysis') await gate;
      return original(schema, messages, opts);
    }) as typeof stub.client.generateObject;
    const cards = async () => {
      const items = (await call('GET', '/api/postings')).json.items as Array<{ id: string; analysis: unknown }>;
      return [a, b].map((id) => items.find((i) => i.id === id)!.analysis);
    };
    const first = await call('POST', '/api/postings/bulk', { ids: [a, b, a, 'nope'], action: 'analyze' });
    try {
      expect(first.json.queued).toBe(2);
      // Each card shows that the analysis runs, and then its verdict.
      expect(await cards()).toEqual([{ state: 'pending', verdict: null }, { state: 'pending', verdict: null }]);
    } finally {
      release();
    }
    await whenIdle();
    expect(stub.calls.analysis).toBe(2);
    expect(await cards()).toEqual([{ state: 'ready', verdict: 'consider' }, { state: 'ready', verdict: 'consider' }]);
    const tooMany = await call('POST', '/api/postings/bulk', { ids: Array.from({ length: 21 }, (_, i) => `x${i}`), action: 'analyze' });
    expect(tooMany.status).toBe(400);
    expect(tooMany.json.error).toBe('Select at most 20 postings for one analysis request.');
  });

  it('keeps the earlier analysis when a new one fails, and deletes on request', async () => {
    await withCv();
    const id = add();
    await call('POST', `/api/postings/${id}/analysis`);
    await whenIdle();
    stub.analysis = () => {
      throw new Error('The model call failed.');
    };
    await call('POST', `/api/postings/${id}/analysis`);
    await whenIdle();
    const kept = (await call('GET', `/api/postings/${id}`)).json.matchAnalysis;
    expect(kept).toMatchObject({ state: 'ready', error: 'The model call failed.' });
    expect(kept.content.verdict).toBe('consider');
    expect((await call('DELETE', `/api/postings/${id}/analysis`)).status).toBe(200);
    expect((await call('GET', `/api/postings/${id}`)).json.matchAnalysis).toBeNull();
    expect((await call('GET', '/api/postings')).json.items.find((i: { id: string }) => i.id === id).analysis).toBeNull();
    expect((await call('DELETE', `/api/postings/${id}/analysis`)).status).toBe(404);
  });

  it('replaces the score with the revised scores of the analysis on request', async () => {
    await withCv();
    const id = add();
    await whenIdle();
    const before = (await call('GET', `/api/postings/${id}`)).json;
    expect(before.match.state).toBe('scored');
    await call('POST', `/api/postings/${id}/analysis`);
    await whenIdle();
    const analysis = (await call('GET', `/api/postings/${id}`)).json.matchAnalysis;
    expect(analysis.scoreApplied).toBe(false);
    expect(typeof analysis.proposedTotal).toBe('number');
    // Running the analysis alone does not change the score.
    expect((await call('GET', `/api/postings/${id}`)).json.match.totalScore).toBe(before.match.totalScore);

    const applied = await call('POST', `/api/postings/${id}/analysis/apply-score`);
    expect(applied.status).toBe(200);
    expect(applied.json).toMatchObject({ scoreApplied: true, proposedTotal: analysis.proposedTotal });
    const after = (await call('GET', `/api/postings/${id}`)).json;
    expect(after.match).toMatchObject({
      state: 'scored', totalScore: analysis.proposedTotal, skillsScore: 95, experienceScore: 90, preferenceScore: 70,
      provider: 'expanded analysis', stale: false,
    });
    expect(after.match.assessment).toBe('You meet the main requirements. One gap decides the outcome.');
  });

  it('rejects model output without scores, and refuses to apply a score that does not exist', async () => {
    await withCv();
    const id = add();
    await whenIdle();
    const { scores: _scores, ...withoutScores } = stub.analysis() as Record<string, unknown>;
    stub.analysis = () => withoutScores;
    await call('POST', `/api/postings/${id}/analysis`);
    await whenIdle();
    const failed = (await call('GET', `/api/postings/${id}`)).json.matchAnalysis;
    expect(failed.state).toBe('failed');
    expect((await call('POST', `/api/postings/${id}/analysis/apply-score`)).json.error).toBe('This analysis has no scores. Run the analysis again.');
  });

  it('keeps the earlier analysis readable while the new one runs, and replaces it when the new one is ready', async () => {
    await withCv();
    const id = add();
    await call('POST', `/api/postings/${id}/analysis`);
    await whenIdle();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const original = stub.client.generateObject.bind(stub.client);
    stub.client.generateObject = (async (schema: any, messages: any, opts: any) => {
      if (opts?.name === 'match_analysis') await gate;
      return original(schema, messages, opts);
    }) as typeof stub.client.generateObject;
    const base = stub.analysis() as object;
    stub.analysis = () => ({ ...base, verdict: 'apply', summary: 'You should apply.' });
    const started = await call('POST', `/api/postings/${id}/analysis`);
    try {
      expect(started.json).toMatchObject({ state: 'pending', content: { verdict: 'consider' } });
      const during = (await call('GET', `/api/postings/${id}`)).json.matchAnalysis;
      expect(during).toMatchObject({ state: 'pending', content: { verdict: 'consider', summary: 'You meet the main requirements. One gap decides the outcome.' } });
    } finally {
      release();
    }
    await whenIdle();
    expect((await call('GET', `/api/postings/${id}`)).json.matchAnalysis).toMatchObject({ state: 'ready', content: { verdict: 'apply', summary: 'You should apply.' } });
  });

  it('stores one analysis for each posting with the model and the date', async () => {
    const clock = fakeClock(Date.parse('2026-11-12T08:00:00Z'));
    await withCv();
    const id = add();
    await call('POST', `/api/postings/${id}/analysis`);
    await whenIdle();
    expect((await call('GET', `/api/postings/${id}`)).json.matchAnalysis).toMatchObject({
      state: 'ready', model: 'stub-model', generatedAt: '2026-11-12T08:00:00.000Z',
    });
    clock.advance(24 * 3600_000);
    (stub.client as { model: string }).model = 'claude-fable-5-2';
    const base = stub.analysis() as object;
    stub.analysis = () => ({ ...base, verdict: 'skip' });
    await call('POST', `/api/postings/${id}/analysis`);
    await whenIdle();
    expect((await call('GET', `/api/postings/${id}`)).json.matchAnalysis).toMatchObject({
      state: 'ready', model: 'claude-fable-5-2', generatedAt: '2026-11-13T08:00:00.000Z', content: { verdict: 'skip' },
    });
    expect(sqlite.prepare('SELECT COUNT(*) AS n FROM match_analyses WHERE posting_id = ?').get(id)).toEqual({ n: 1 });
  });

  it('runs an analysis at once while matching is paused and the match queue holds work', async () => {
    await withCv();
    await call('POST', '/api/matching/pause');
    const id = add();
    await whenIdle();
    expect((await call('GET', '/api/status')).json).toMatchObject({ matchingPaused: true, queueTotal: 1 });
    await call('POST', `/api/postings/${id}/analysis`);
    await whenIdle();
    expect(stub.calls.analysis).toBe(1);
    expect((await call('GET', `/api/postings/${id}`)).json.matchAnalysis).toMatchObject({ state: 'ready', content: { verdict: 'consider' } });
    // The match work still waits.
    expect(stub.calls.extract).toBe(0);
    expect((await call('GET', '/api/status')).json.queueTotal).toBe(1);
  });

  it('reports a failure when no earlier analysis exists', async () => {
    await withCv();
    const id = add();
    stub.analysis = () => ({ verdict: 'maybe' });
    await call('POST', `/api/postings/${id}/analysis`);
    await whenIdle();
    const failed = (await call('GET', `/api/postings/${id}`)).json.matchAnalysis;
    expect(failed.state).toBe('failed');
    expect(failed.content).toBeNull();
    expect(failed.error).toBeTruthy();
  });
});

describe('cover letters', () => {
  const CV_TEXT = `Jane Doe\nSenior developer with eight years of TypeScript and React.\n${'Built web applications for logistics companies. '.repeat(8)}`;

  async function withCv(): Promise<void> {
    await call('POST', '/api/profile/cv', { text: CV_TEXT, edits: 'keep' });
    await whenIdle();
  }

  it('refuses a letter before a CV exists, and for an unknown posting', async () => {
    const id = add();
    const refused = await call('POST', `/api/postings/${id}/cover-letter`, {});
    expect(refused.status).toBe(400);
    expect(refused.json.error).toBe('Import a CV first. The letter is written from your CV.');
    await withCv();
    expect((await call('POST', '/api/postings/nope/cover-letter', {})).status).toBe(404);
    expect(stub.calls.letter).toBe(0);
  });

  it('writes a letter from the CV, the posting, and the instruction, and shows it in the detail', async () => {
    await withCv();
    const id = add({ title: 'Frontend Engineer', company: 'Acme' });
    const started = await call('POST', `/api/postings/${id}/cover-letter`, { instruction: 'Mention my open source work.' });
    expect(started.status).toBe(202);
    expect(started.json).toMatchObject({ state: 'pending', text: null });
    await whenIdle();
    expect(stub.calls.letter).toBe(1);
    expect(stub.lastLetterInput).toContain('Frontend Engineer');
    expect(stub.lastLetterInput).toContain('Jane Doe');
    expect(stub.lastLetterInput).toContain('Mention my open source work.');
    // The structured profile, as the profile route returns it, is part of the input.
    const profile = (await call('GET', '/api/profile')).json.effective;
    expect(profile).toEqual(PROFILE);
    expect(stub.lastLetterInput).toContain('STRUCTURED PROFILE');
    expect(stub.lastLetterInput).toContain(JSON.stringify(profile));
    const detail = await call('GET', `/api/postings/${id}`);
    expect(detail.json.coverLetter).toMatchObject({ state: 'ready', language: 'English', edited: false, instruction: 'Mention my open source work.' });
    expect(detail.json.coverLetter.text).toContain('Dear hiring team');
  });

  it('replaces the stored text with the new text when a second generation succeeds', async () => {
    await withCv();
    const id = add();
    await call('POST', `/api/postings/${id}/cover-letter`, {});
    await whenIdle();
    const first = (await call('GET', `/api/postings/${id}`)).json.coverLetter;
    expect(first).toMatchObject({ state: 'ready' });
    expect(first.text).toContain('Dear hiring team');

    const NEW_TEXT = `Hello Acme,\n\n${'I ship accessible interfaces and I measure their speed. '.repeat(3).trim()}\n\nRegards,\nJane Doe`;
    stub.letter = () => ({ language: 'English', letter: NEW_TEXT });
    const again = await call('POST', `/api/postings/${id}/cover-letter`, {});
    expect(again.status).toBe(202);
    // The earlier letter stays readable while the new one is written.
    expect(again.json).toMatchObject({ state: 'pending', text: first.text });
    await whenIdle();
    expect(stub.calls.letter).toBe(2);
    const second = (await call('GET', `/api/postings/${id}`)).json.coverLetter;
    expect(second).toMatchObject({ state: 'ready', text: NEW_TEXT, error: null, edited: false });
  });

  it('stores an edit, and keeps the earlier letter when a new generation fails', async () => {
    await withCv();
    const id = add();
    await call('POST', `/api/postings/${id}/cover-letter`, {});
    await whenIdle();
    const saved = await call('PUT', `/api/postings/${id}/cover-letter`, { text: 'My own text.' });
    expect(saved.json).toMatchObject({ text: 'My own text.', edited: true });

    stub.letter = () => ({ nonsense: true });
    await call('POST', `/api/postings/${id}/cover-letter`, {});
    await whenIdle();
    const after = (await call('GET', `/api/postings/${id}`)).json.coverLetter;
    expect(after).toMatchObject({ state: 'ready', text: 'My own text.' });
    expect(after.error).toBeTruthy();
  });

  it('reports a failed first generation with its cause', async () => {
    await withCv();
    const id = add();
    stub.letter = () => ({ nonsense: true });
    await call('POST', `/api/postings/${id}/cover-letter`, {});
    await whenIdle();
    const letter = (await call('GET', `/api/postings/${id}`)).json.coverLetter;
    expect(letter).toMatchObject({ state: 'failed', text: null });
    expect(letter.error).toBeTruthy();
  });

  it('runs a letter while matching is paused and the match lane is blocked', async () => {
    await withCv();
    const id = add();
    await call('POST', '/api/matching/pause');
    await call('POST', `/api/postings/${id}/cover-letter`, {});
    await whenIdle();
    expect(stub.calls.letter).toBe(1);
  });

  it('serves the letter as a PDF file, with Danish letters', async () => {
    await withCv();
    const id = add({ title: 'Udvikler', company: 'Ærø & Søn' });
    expect((await call('GET', `/api/postings/${id}/cover-letter.pdf`)).status).toBe(404);
    await call('POST', `/api/postings/${id}/cover-letter`, {});
    await whenIdle();
    await call('PUT', `/api/postings/${id}/cover-letter`, { text: `Kære Ærø & Søn,\n\n${'Jeg bygger webløsninger på tværs af brancher. '.repeat(120)}\n\nVenlig hilsen\nJane → Doe 日本` });
    const res = await app.request(`/api/postings/${id}/cover-letter.pdf`);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('application/pdf');
    expect(res.headers.get('Content-Disposition')).toContain('cover-letter-r-s-n-udvikler.pdf');
    const bytes = Buffer.from(await res.arrayBuffer());
    expect(bytes.subarray(0, 5).toString()).toBe('%PDF-');
    // The long text needs more than one page.
    expect((await PDFDocument.load(bytes)).getPageCount()).toBeGreaterThan(1);
    // The file holds the letter text. Line breaks differ, because the PDF wraps the lines.
    const words = (t: string) => t.split(/\s+/).filter(Boolean).join(' ');
    const pdfText = words(await extractCvText({ name: 'letter.pdf', type: 'application/pdf', bytes: new Uint8Array(bytes) }));
    expect(pdfText.startsWith('Kære Ærø & Søn, Jeg bygger webløsninger på tværs af brancher.')).toBe(true);
    expect(pdfText.split('Jeg bygger webløsninger på tværs af brancher.').length - 1).toBe(120);
    // The arrow has a replacement. The standard font has no Japanese characters, so each one becomes "?".
    expect(pdfText.endsWith('Venlig hilsen Jane -> Doe ??')).toBe(true);
  });

  it('deletes the letter', async () => {
    await withCv();
    const id = add();
    await call('POST', `/api/postings/${id}/cover-letter`, {});
    await whenIdle();
    expect((await call('DELETE', `/api/postings/${id}/cover-letter`)).status).toBe(200);
    expect((await call('GET', `/api/postings/${id}`)).json.coverLetter).toBeNull();
  });
});
