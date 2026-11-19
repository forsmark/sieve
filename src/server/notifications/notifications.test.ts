import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../http/app';
import { setPasswordForTests } from '../http/auth';
import { sqlite } from '../kernel/db';
import { setSetting } from '../kernel/settings';
import { MAX_ATTEMPTS, whenIdle } from '../kernel/tasks';
import { ingestPosting } from '../ingestion/ingest';
import { registerMatchingHandlers } from '../matching/handlers';
import { rescorePostings } from '../matching/rescore';
import { importCv, saveProfileEdits } from '../profile/service';
import { JUDGMENT, PROFILE, fakeClock, matchOf, raw, resetAll, stubLlm, tasksOf, type StubLlm } from '../testing/helpers';
import {
  buildMessage, generateTopic, getNotificationSettings, regenerateTopic, registerNotifyHandler, saveNotificationSettings, sendTestNotification,
  setNotificationFetchForTests, subscribeUrl,
} from './service';

// ---- A stub ntfy server

interface Received {
  path: string;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}

let server: Server;
let serverUrl: string;
let received: Received[] = [];
let status = 200;

beforeAll(async () => {
  server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      received.push({ path: req.url ?? '', headers: req.headers, body });
      res.writeHead(status);
      res.end('{}');
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  serverUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

let stub: StubLlm;
let clock: ReturnType<typeof fakeClock>;
const WINDOW = 120_000;

beforeEach(async () => {
  await resetAll();
  setNotificationFetchForTests(null);
  received = [];
  status = 200;
  stub = stubLlm();
  registerMatchingHandlers();
  registerNotifyHandler();
  saveProfileEdits(PROFILE);
  clock = fakeClock();
});

function enable(patch: Parameters<typeof saveNotificationSettings>[0] = {}) {
  return saveNotificationSettings({ enabled: true, server: serverUrl, ...patch });
}

function score(total: number) {
  stub.judgment = () => ({ ...JUDGMENT, skillsFit: total, experienceFit: total, preferenceFit: total });
  setSetting('app.baseUrl', 'https://jobs.example.test');
}

let n = 0;
function add(title = 'Frontend Developer', company = `Company ${++n}`): string {
  const r = ingestPosting('a', raw({ externalId: `job-${++n}`, title, company }));
  if (r.status === 'invalid') throw new Error('invalid');
  return r.id;
}

async function passWindow() {
  await whenIdle();
  clock.advance(WINDOW + 1000);
  await whenIdle();
}

describe('topic', () => {
  it('generates a topic with 120 random bits behind a fixed prefix', () => {
    const topic = generateTopic();
    expect(topic).toMatch(/^sieve-[a-z2-7]{24}$/);
    // 24 characters from 32 symbols are 24 * 5 = 120 bits.
    const many = new Set(Array.from({ length: 500 }, generateTopic));
    expect(many.size).toBe(500);
  });

  it('generates the topic and the subscribe link when the user enables notifications for the first time', () => {
    expect(getNotificationSettings()).toMatchObject({ enabled: false, topic: null });
    expect(subscribeUrl(getNotificationSettings())).toBeNull();
    const s = enable();
    expect(s.topic).toMatch(/^sieve-[a-z2-7]{24}$/);
    expect(subscribeUrl(s)).toBe(`${serverUrl}/${s.topic}`);
    // A second save keeps the topic.
    expect(enable({ threshold: 70 }).topic).toBe(s.topic);
  });

  it('uses the public server and the threshold 80 by default', () => {
    expect(getNotificationSettings()).toMatchObject({ server: 'https://ntfy.sh', threshold: 80, windowSeconds: 120 });
  });

  it('sends only to the new topic after the user regenerates it', async () => {
    const old = enable().topic!;
    const next = regenerateTopic().topic!;
    expect(next).not.toBe(old);
    score(90);
    add();
    await passWindow();
    expect(received.map((r) => r.path)).toEqual([`/${next}`]);
  });

  it('sends a notification that waits in the window to the new topic when the user regenerates the topic', async () => {
    const old = enable().topic!;
    score(90);
    const id = add();
    await whenIdle();
    // The posting qualified and waits for the window to end.
    expect(matchOf(id)!.notify_queued_at).not.toBeNull();
    expect(received).toHaveLength(0);
    const next = regenerateTopic().topic!;
    clock.advance(WINDOW + 1000);
    await whenIdle();
    expect(received.map((r) => r.path)).toEqual([`/${next}`]);
    expect(received.filter((r) => r.path === `/${old}`)).toHaveLength(0);
  });

  it('sends to the server address that the user saved', async () => {
    enable({ server: `${serverUrl}/` });
    expect(getNotificationSettings().server).toBe(serverUrl);
    expect(() => saveNotificationSettings({ server: 'ftp://example.test' })).toThrow();
    score(90);
    add();
    await passWindow();
    expect(received).toHaveLength(1);
  });
});

describe('notification for high scores', () => {
  it('sends one notification with title, company, score, and a link to the posting', async () => {
    const topic = enable().topic!;
    score(85);
    const id = add('Senior Frontend Developer', 'Acme A/S');
    await whenIdle();
    expect(matchOf(id)!.total_score).toBe(87);
    expect(received).toHaveLength(0);
    clock.advance(WINDOW + 1000);
    await whenIdle();
    expect(received).toHaveLength(1);
    const msg = received[0]!;
    expect(msg.path).toBe(`/${topic}`);
    expect(msg.headers.title).toBe(`=?UTF-8?B?${Buffer.from('87 · Senior Frontend Developer').toString('base64')}?=`);
    expect(msg.body).toBe('Acme A/S');
    expect(msg.headers.click).toBe(`https://jobs.example.test/jobs?id=${id}`);
    expect(msg.headers.tags).toBe('briefcase');
    expect(matchOf(id)!.notified_at).not.toBeNull();
    expect(sqlite.prepare('SELECT state, attempts FROM notifications').all()).toEqual([{ state: 'sent', attempts: 1 }]);
  });

  it('holds only title, company, score, and link, and no CV, profile, or assessment text', async () => {
    enable();
    importCv('SECRET-CV-TEXT Jane Doe, frontend developer with six years of experience.', 'keep');
    stub.judgment = () => ({ ...JUDGMENT, skillsFit: 95, experienceFit: 95, preferenceFit: 95, assessment: 'SECRET-ASSESSMENT you fit well.', matchedSkills: ['SECRET-SKILL'] });
    add('Data Engineer', 'Beta Corp');
    await passWindow();
    expect(received).toHaveLength(1);
    const all = JSON.stringify(received[0]);
    expect(all).not.toContain('SECRET');
    expect(all).not.toContain(PROFILE.headline);
    expect(all).not.toContain('This role needs');
    const message = buildMessage([{ id: 'p1', title: 'Data Engineer', company: 'Beta Corp', total_score: 91 }], 'http://localhost:3000/');
    expect(message).toEqual({ title: '91 · Data Engineer', body: 'Beta Corp', click: 'http://localhost:3000/jobs?id=p1', tags: ['briefcase'] });
  });

  it('sends no notification for a first score below the threshold', async () => {
    enable();
    score(70);
    add();
    await passWindow();
    expect(received).toHaveLength(0);
    expect(tasksOf('notify')).toHaveLength(0);
  });

  it('sends no notification when a rescore moves a scored posting above the threshold', async () => {
    enable();
    score(60);
    const id = add();
    await passWindow();
    score(95);
    rescorePostings([id]);
    await passWindow();
    expect(matchOf(id)!.total_score).toBeGreaterThan(90);
    expect(received).toHaveLength(0);
  });

  it('sends no notification while notifications are disabled', async () => {
    score(95);
    add();
    await passWindow();
    expect(received).toHaveLength(0);
  });

  it('sends at most one notification for each posting', async () => {
    enable();
    score(95);
    const id = add();
    await passWindow();
    rescorePostings([id]);
    await passWindow();
    expect(received).toHaveLength(1);
  });

  it('sends one notification that states six new matches when six postings qualify in the window', async () => {
    enable();
    score(90);
    for (let i = 0; i < 6; i++) add(`Role ${i} Engineer`);
    await passWindow();
    expect(received).toHaveLength(1);
    expect(received[0]!.headers.title).toBe('6 new matches');
    expect(received[0]!.headers.click).toBe('https://jobs.example.test/jobs');
    const lines = received[0]!.body.split('\n');
    expect(lines).toHaveLength(6);
    expect(lines[5]).toBe('and 1 more');

    // A posting after the window gets its own notification.
    add('Late Arrival Engineer');
    await passWindow();
    expect(received).toHaveLength(2);
  });

  it('lists the highest-scored postings first and states how many more qualified', async () => {
    enable();
    setSetting('app.baseUrl', 'https://jobs.example.test');
    // The judge gives each posting the fit that its title names.
    stub.judgment = (user) => {
      const fit = Number(/Fit (\d+)/.exec(user)![1]);
      return { ...JUDGMENT, skillsFit: fit, experienceFit: fit, preferenceFit: fit };
    };
    const fits = [82, 97, 85, 91, 99, 88, 94];
    const ids = fits.map((fit) => add(`Fit ${fit} Engineer`));
    await passWindow();
    expect(received).toHaveLength(1);
    const totals = ids.map((id) => matchOf(id)!.total_score as number).sort((a, b) => b - a);
    expect(received[0]!.headers.title).toBe('7 new matches');
    const lines = received[0]!.body.split('\n');
    // The five highest totals, the highest first, then the number of the others.
    expect(lines.slice(0, 5).map((l) => Number(l.split(' · ')[0]))).toEqual(totals.slice(0, 5));
    expect(lines[0]).toContain('Fit 99 Engineer');
    expect(lines[4]).toContain('Fit 88 Engineer');
    expect(lines[5]).toBe('and 2 more');
    expect(lines).toHaveLength(6);
  });

  it('sends nothing when the user disables notifications during the window', async () => {
    enable();
    score(90);
    add();
    await whenIdle();
    saveNotificationSettings({ enabled: false });
    clock.advance(WINDOW + 1000);
    await whenIdle();
    expect(received).toHaveLength(0);
  });
});

describe('delivery', () => {
  it('reports success for a test message that the server accepts', async () => {
    enable();
    expect(await sendTestNotification()).toEqual({ ok: true });
    expect(received[0]!.body).toBe('Notifications work.');
  });

  it('reports the cause when the test message fails', async () => {
    expect(await sendTestNotification()).toMatchObject({ ok: false });
    enable();
    status = 500;
    expect(await sendTestNotification()).toEqual({ ok: false, error: 'ntfy server returned HTTP 500' });
    saveNotificationSettings({ server: 'http://127.0.0.1:1' });
    const result = await sendTestNotification();
    expect(result.ok).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it('continues matching while the server fails, and retries the delivery later', async () => {
    enable();
    status = 503;
    score(90);
    const first = add();
    await passWindow();
    expect(received).toHaveLength(1);
    expect(tasksOf('notify')[0]).toMatchObject({ state: 'pending', attempts: 1 });
    expect(matchOf(first)!.notified_at).toBeNull();

    // Matching is not affected by the failed delivery.
    const second = add('Data Engineer');
    await whenIdle();
    expect(matchOf(second)!.state).toBe('scored');

    // The server works again. The retry delivers both postings in one message.
    status = 200;
    clock.advance(10 * 60_000);
    await whenIdle();
    expect(received).toHaveLength(2);
    expect(received[1]!.headers.title).toBe('2 new matches');
    expect(matchOf(first)!.notified_at).not.toBeNull();
  });

  it('records the failure after the retry limit and does not notify about the posting again', async () => {
    enable();
    status = 503;
    score(90);
    const id = add();
    await whenIdle();
    for (let i = 0; i < 8; i++) {
      clock.advance(10 * 60_000);
      await whenIdle();
    }
    expect(received).toHaveLength(MAX_ATTEMPTS);
    expect(sqlite.prepare('SELECT state, attempts, error FROM notifications').all()).toEqual([
      { state: 'failed', attempts: MAX_ATTEMPTS, error: 'ntfy server returned HTTP 503' },
    ]);
    expect(matchOf(id)!.notified_at).not.toBeNull();
    expect(sqlite.prepare(`SELECT COUNT(*) AS n FROM logs WHERE level = 'error'`).get()).toEqual({ n: 1 });

    // No retry is left, so the server receives nothing more.
    clock.advance(60 * 60_000);
    await whenIdle();
    expect(received).toHaveLength(MAX_ATTEMPTS);
    expect(tasksOf('notify').filter((t) => t.state === 'pending')).toHaveLength(0);

    // The activity view lists the notification as failed, with the error.
    setPasswordForTests(undefined);
    const activity = (await (await createApp().request('/api/activity')).json()) as { notifications: unknown[] };
    expect(activity.notifications).toEqual([
      expect.objectContaining({ count: 1, state: 'failed', error: 'ntfy server returned HTTP 503' }),
    ]);
  });
});
