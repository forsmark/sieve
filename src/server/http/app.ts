import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { Hono, type Context } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { streamSSE } from 'hono/streaming';
import { z } from 'zod';
import { sqlite } from '../kernel/db';
import { subscribe } from '../kernel/events';
import { errorMessage } from '../kernel/logger';
import { getSetting, setSetting } from '../kernel/settings';
import { queueCounts, retryTask } from '../kernel/tasks';
import { publish } from '../kernel/events';
import { createApplication, listApplicationEvents, listApplications, removeApplication, updateApplication } from '../applications/service';
import { separateDuplicate } from '../ingestion/ingest';
import { isLlmAvailable, probe, saveLlmSettings } from '../llm';
import { CLAUDE_CODE_MODEL, WRITING_EFFORT, WRITING_MODEL } from '../llm/claude-code';
import { letterFileName, renderLetterPdf } from '../letters/pdf';
import { MatchAnalysisError, applyAnalysisScore, deleteMatchAnalysis, requestMatchAnalyses, requestMatchAnalysis } from '../analysis/service';
import { CoverLetterError, deleteCoverLetter, getCoverLetter, requestCoverLetter, saveCoverLetterText } from '../letters/service';
import { planRescore, rescorePostings } from '../matching/rescore';
import {
  getNotificationSettings, regenerateTopic, saveNotificationSettings, sendTestNotification, subscribeUrl,
} from '../notifications/service';
import { CvImportError, cleanCvText, extractCvText } from '../profile/cv-import';
import {
  discardEdits, getPreferences, getProfile, importCv, parsePreferences, requestDerive, saveProfileEdits, savePreferences,
} from '../profile/service';
import { listAdapters } from '../sources/registry';
import { getActiveRunId, lastCompletedRunAt, listRuns, startFetchRun } from '../sources/runner';
import { getSchedule, updateSchedule } from '../sources/schedule';
import { ApplicationStage, StructuredProfile, TriageStatus } from '../../shared/schemas';
import type {
  ActivityDto, FailedTaskDto, LlmSettingsDto, LogDto, NotificationLogDto, NotificationSettingsDto, ProfileDto, RunDto, SourceDto, StatusDto,
} from '../../shared/api';
import {
  SESSION_COOKIE, allowLoginAttempt, authRequired, checkPassword, clearLoginAttempts, createSession, deleteSession, isValidSession,
} from './auth';
import { backupPath, createBackup, listBackups } from './backup';
import { gatewayUserCheck } from './edge';
import { applyTriage, getCounts, getPostingDetail, listPostings, markRead, setTriage } from './postings';

const MAX_CV_BYTES = 5 * 1024 * 1024;

function profileDto(): ProfileDto {
  const p = getProfile();
  return {
    hasCv: p.hasCv && p.cvText.length > 0,
    cvText: p.cvText,
    derived: p.derived,
    effective: p.effective,
    hasEdits: p.hasEdits,
    deriveState: p.deriveState,
    deriveError: p.deriveError,
    updatedAt: p.updatedAt,
  };
}

function notificationDto(): NotificationSettingsDto {
  const s = getNotificationSettings();
  return { ...s, subscribeUrl: subscribeUrl(s), appBaseUrl: getSetting('app.baseUrl') };
}

function llmDto(): LlmSettingsDto {
  return { ...getSetting('llm'), claudeModel: CLAUDE_CODE_MODEL, writingModel: WRITING_MODEL, writingEffort: WRITING_EFFORT };
}

export function statusDto(): StatusDto {
  const queue = queueCounts();
  const profile = getProfile();
  return {
    authRequired: authRequired(),
    profileReady: profile.effective !== null,
    hasCv: profile.hasCv && profile.cvText.length > 0,
    activeRunId: getActiveRunId(),
    lastRunAt: lastCompletedRunAt(),
    schedule: getSchedule(),
    queue,
    queueTotal: Object.values(queue).reduce((a, b) => a + b, 0),
    matchingPaused: getSetting('matching.paused'),
    llmAvailable: isLlmAvailable(),
    llmProvider: getSetting('llm').provider,
    searchTermCount: getSetting('search').terms.length,
    counts: getCounts(),
  };
}

function sourcesDto(): SourceDto[] {
  const disabled = new Set(getSetting('sources.disabled'));
  const last = sqlite.prepare(
    `SELECT s.source, s.state, s.found, s.added, s.invalid, s.error, r.started_at FROM fetch_run_sources s
     JOIN fetch_runs r ON r.id = s.run_id WHERE s.source = ? AND s.state != 'skipped' ORDER BY s.run_id DESC LIMIT 1`,
  );
  return listAdapters().map((a) => {
    const row = last.get(a.id) as (SourceDto['lastResult'] & { started_at: string }) | undefined;
    return {
      id: a.id,
      name: a.name,
      enabled: !disabled.has(a.id),
      supports: a.supports,
      lastResult: row ? { source: row.source, state: row.state, found: row.found, added: row.added, invalid: row.invalid, error: row.error } : null,
      lastRunAt: row?.started_at ?? null,
    };
  });
}

function activityDto(): ActivityDto {
  const failedTasks = (
    sqlite
      .prepare(
        `SELECT t.id, t.kind, t.subject_id, t.attempts, t.last_error, t.finished_at, p.title FROM tasks t
         LEFT JOIN postings p ON p.id = t.subject_id WHERE t.state = 'failed' ORDER BY t.finished_at DESC LIMIT 100`,
      )
      .all() as Array<{ id: number; kind: string; subject_id: string; attempts: number; last_error: string | null; finished_at: string | null; title: string | null }>
  ).map((t): FailedTaskDto => ({
    id: t.id, kind: t.kind, subjectId: t.subject_id, subjectTitle: t.title, attempts: t.attempts, lastError: t.last_error, finishedAt: t.finished_at,
  }));
  const notifications = (
    sqlite.prepare('SELECT id, posting_ids, state, error, created_at FROM notifications ORDER BY id DESC LIMIT 30').all() as Array<{
      id: number; posting_ids: string; state: 'sent' | 'failed'; error: string | null; created_at: string;
    }>
  ).map((n): NotificationLogDto => {
    let count = 0;
    try {
      count = (JSON.parse(n.posting_ids) as unknown[]).length;
    } catch {
      // Keep zero.
    }
    return { id: n.id, count, state: n.state, error: n.error, createdAt: n.created_at };
  });
  return { runs: listRuns(20) as RunDto[], failedTasks, notifications };
}

const idsSchema = z.object({ ids: z.array(z.string()).min(1).max(1000) });
const bulkSchema = idsSchema.extend({ action: z.enum(['save', 'dismiss', 'restore', 'apply', 'rescore', 'read', 'unread', 'analyze']) });
const llmSchema = z.object({
  provider: z.enum(['local', 'claude-code']),
  baseUrl: z.string().trim().max(500),
  model: z.string().trim().max(200),
  apiKey: z.string().max(500).default(''),
  claudeEffort: z.enum(['low', 'medium']),
});

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json', '.woff2': 'font/woff2',
  '.webmanifest': 'application/manifest+json', '.txt': 'text/plain; charset=utf-8',
};

function clientKey(c: Context): string {
  const env = c.env as { incoming?: { socket?: { remoteAddress?: string } } } | undefined;
  return env?.incoming?.socket?.remoteAddress ?? 'local';
}

export interface AppOptions {
  /** Directory of the built client. When it exists, the server also serves the interface. */
  clientDir?: string;
}

/** The icon of the built client, or the source file when no client is built. */
function iconFile(clientDir: string | undefined): string {
  const built = clientDir ? join(resolve(clientDir), 'icon.png') : null;
  return built && existsSync(built) ? built : resolve('src/client/public/icon.png');
}

export function createApp(opts: AppOptions = {}): Hono {
  const app = new Hono();

  app.onError((err, c) => {
    if (err instanceof z.ZodError) return c.json({ error: z.prettifyError(err) }, 400);
    if (err instanceof CvImportError) return c.json({ error: err.message }, 400);
    if (err instanceof CoverLetterError) return c.json({ error: err.message }, err.message === 'Posting not found.' ? 404 : 400);
    if (err instanceof MatchAnalysisError) return c.json({ error: err.message }, err.message === 'Posting not found.' ? 404 : 400);
    if (err instanceof SyntaxError) return c.json({ error: 'The request body is not valid JSON.' }, 400);
    return c.json({ error: errorMessage(err) }, 500);
  });

  // Behind the olympus-edge gateway only the allowed user passes. The health check and the icon stay open.
  app.use('*', gatewayUserCheck());

  // The health routes need no login and no database. The platform probes `/healthz`.
  app.get('/api/health', (c) => c.json({ ok: true }));
  app.get('/healthz', (c) => c.json({ ok: true }));

  // Home screens fetch the icon without a session.
  const icon = iconFile(opts.clientDir);
  app.get('/icon.png', (c) => {
    if (!existsSync(icon)) return c.notFound();
    return new Response(new Uint8Array(readFileSync(icon)), { headers: { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=86400' } });
  });

  // ---- Login

  app.get('/api/auth/me', (c) => {
    const required = authRequired();
    return c.json({ authRequired: required, authenticated: !required || isValidSession(getCookie(c, SESSION_COOKIE)) });
  });

  app.post('/api/auth/login', async (c) => {
    if (!authRequired()) return c.json({ ok: true });
    const key = clientKey(c);
    if (!allowLoginAttempt(key)) return c.json({ error: 'Too many attempts. Try again in 15 minutes.' }, 429);
    const body = z.object({ password: z.string() }).parse(await c.req.json());
    if (!checkPassword(body.password)) return c.json({ error: 'Wrong password.' }, 401);
    clearLoginAttempts(key);
    const session = createSession();
    setCookie(c, SESSION_COOKIE, session.token, {
      httpOnly: true, sameSite: 'Lax', path: '/', maxAge: session.maxAgeSeconds, secure: new URL(c.req.url).protocol === 'https:',
    });
    return c.json({ ok: true });
  });

  app.post('/api/auth/logout', (c) => {
    deleteSession(getCookie(c, SESSION_COOKIE));
    deleteCookie(c, SESSION_COOKIE, { path: '/' });
    return c.json({ ok: true });
  });

  app.use('/api/*', async (c, next) => {
    if (authRequired() && !isValidSession(getCookie(c, SESSION_COOKIE))) return c.json({ error: 'Login required.' }, 401);
    await next();
  });

  // ---- Status and live events

  app.get('/api/status', (c) => c.json(statusDto()));

  app.get('/api/events', (c) =>
    streamSSE(c, async (stream) => {
      let open = true;
      const unsubscribe = subscribe((event) => {
        if (open) void stream.writeSSE({ data: JSON.stringify(event) }).catch(() => {});
      });
      stream.onAbort(() => {
        open = false;
        unsubscribe();
      });
      await stream.writeSSE({ event: 'ready', data: '{}' });
      while (open) {
        await stream.sleep(25_000);
        if (open) await stream.writeSSE({ event: 'ping', data: '{}' }).catch(() => {});
      }
    }),
  );

  // ---- Postings

  app.get('/api/postings', (c) => {
    const q = c.req.query();
    const num = (v: string | undefined) => (v !== undefined && v !== '' && Number.isFinite(Number(v)) ? Number(v) : undefined);
    return c.json(
      listPostings({
        status: q.status || undefined,
        source: q.source || undefined,
        work: q.work || undefined,
        minScore: num(q.minScore),
        tag: q.tag || undefined,
        maxAgeDays: num(q.maxAgeDays),
        q: q.q || undefined,
        unread: q.unread === '1' || q.unread === 'true',
        showExcluded: q.showExcluded === '1' || q.showExcluded === 'true',
        showDuplicates: q.showDuplicates === '1' || q.showDuplicates === 'true',
        sort: q.sort === 'newest' ? 'newest' : 'score',
        offset: num(q.offset),
        limit: num(q.limit),
      }),
    );
  });

  app.post('/api/postings/bulk', async (c) => {
    const body = bulkSchema.parse(await c.req.json());
    if (body.action === 'rescore') return c.json({ queued: rescorePostings(body.ids), previous: [] });
    if (body.action === 'analyze') return c.json({ queued: requestMatchAnalyses(body.ids).length, previous: [] });
    if (body.action === 'read' || body.action === 'unread') {
      markRead(body.ids, body.action === 'read');
      return c.json({ previous: [] });
    }
    return c.json(applyTriage(body.ids, body.action));
  });

  /** Undo of a triage action. The client sends back the statuses that the action returned. */
  app.post('/api/postings/restore', async (c) => {
    const body = z.object({ previous: z.array(z.object({ id: z.string(), triageStatus: TriageStatus })).max(1000) }).parse(await c.req.json());
    for (const p of body.previous) setTriage(p.id, p.triageStatus);
    return c.json({ ok: true });
  });

  app.get('/api/postings/:id', (c) => {
    const detail = getPostingDetail(c.req.param('id'));
    return detail ? c.json(detail) : c.json({ error: 'Posting not found.' }, 404);
  });

  app.patch('/api/postings/:id', async (c) => {
    const id = c.req.param('id');
    const body = z
      .object({ action: z.enum(['save', 'dismiss', 'restore', 'apply']).optional(), read: z.boolean().optional() })
      .parse(await c.req.json());
    if (!getPostingDetail(id)) return c.json({ error: 'Posting not found.' }, 404);
    if (body.read !== undefined) markRead([id], body.read);
    const result = body.action ? applyTriage([id], body.action) : { previous: [] };
    return c.json({ ...result, posting: getPostingDetail(id) });
  });

  app.post('/api/postings/:id/separate', (c) => {
    const id = c.req.param('id');
    return separateDuplicate(id) ? c.json(getPostingDetail(id)) : c.json({ error: 'The posting is not a duplicate.' }, 400);
  });

  app.post('/api/postings/:id/rescore', (c) => c.json({ queued: rescorePostings([c.req.param('id')]) }));

  // ---- Expanded match analysis

  app.post('/api/postings/:id/analysis', (c) => c.json(requestMatchAnalysis(c.req.param('id')), 202));

  app.post('/api/postings/:id/analysis/apply-score', (c) => c.json(applyAnalysisScore(c.req.param('id'))));

  app.delete('/api/postings/:id/analysis', (c) =>
    deleteMatchAnalysis(c.req.param('id')) ? c.json({ ok: true }) : c.json({ error: 'No analysis exists for this posting.' }, 404),
  );

  // ---- Cover letters

  app.post('/api/postings/:id/cover-letter', async (c) => {
    const body = z.object({ instruction: z.string().max(2000).nullable().optional() }).parse(await c.req.json().catch(() => ({})));
    return c.json(requestCoverLetter(c.req.param('id'), body.instruction ?? null), 202);
  });

  app.put('/api/postings/:id/cover-letter', async (c) => {
    const body = z.object({ text: z.string().min(1).max(20_000) }).parse(await c.req.json());
    const saved = saveCoverLetterText(c.req.param('id'), body.text);
    return saved ? c.json(saved) : c.json({ error: 'No finished cover letter exists for this posting.' }, 404);
  });

  app.delete('/api/postings/:id/cover-letter', (c) =>
    deleteCoverLetter(c.req.param('id')) ? c.json({ ok: true }) : c.json({ error: 'No cover letter exists for this posting.' }, 404),
  );

  app.get('/api/postings/:id/cover-letter.pdf', async (c) => {
    const id = c.req.param('id');
    const letter = getCoverLetter(id);
    const posting = sqlite.prepare('SELECT title, company FROM postings WHERE id = ?').get(id) as { title: string; company: string } | undefined;
    if (!letter?.text || !posting) return c.json({ error: 'No cover letter exists for this posting.' }, 404);
    const bytes = await renderLetterPdf(letter.text, { title: `Cover letter: ${posting.title}, ${posting.company}` });
    return new Response(new Uint8Array(bytes), {
      headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${letterFileName(posting.company, posting.title)}"` },
    });
  });

  // ---- Profile and preferences

  app.get('/api/profile', (c) => c.json(profileDto()));

  app.post('/api/profile/cv', async (c) => {
    const type = c.req.header('content-type') ?? '';
    let text: string;
    let edits: 'keep' | 'discard' = 'keep';
    if (type.includes('multipart/form-data')) {
      const form = await c.req.parseBody();
      if (form.edits === 'discard') edits = 'discard';
      const file = form.file;
      if (file instanceof File) {
        if (file.size > MAX_CV_BYTES) throw new CvImportError('The file is larger than 5 MB.');
        text = await extractCvText({ name: file.name, type: file.type, bytes: new Uint8Array(await file.arrayBuffer()) });
      } else if (typeof form.text === 'string') {
        text = cleanCvText(form.text);
      } else {
        throw new CvImportError('Send a file or text.');
      }
    } else {
      const body = z.object({ text: z.string().max(200_000), edits: z.enum(['keep', 'discard']).default('keep') }).parse(await c.req.json());
      text = cleanCvText(body.text);
      edits = body.edits;
    }
    importCv(text, edits);
    return c.json(profileDto());
  });

  app.put('/api/profile', async (c) => {
    saveProfileEdits(StructuredProfile.parse(await c.req.json()));
    const plan = planRescore();
    return c.json({ profile: profileDto(), plan });
  });

  app.post('/api/profile/derive', (c) => {
    try {
      requestDerive();
    } catch (err) {
      return c.json({ error: errorMessage(err) }, 400);
    }
    return c.json(profileDto());
  });

  app.delete('/api/profile/edits', (c) => {
    discardEdits();
    const plan = planRescore();
    return c.json({ profile: profileDto(), plan });
  });

  app.get('/api/preferences', (c) => c.json(getPreferences()));

  /** `?dryRun=1` returns the cost of the change and stores nothing. */
  app.put('/api/preferences', async (c) => {
    const body = await c.req.json();
    if (c.req.query('dryRun')) {
      return c.json({ preferences: getPreferences(), plan: planRescore({ preferences: parsePreferences(body) }) });
    }
    const preferences = savePreferences(body);
    return c.json({ preferences, plan: planRescore() });
  });

  // ---- Sources, search, schedule, runs

  app.get('/api/sources', (c) => c.json(sourcesDto()));

  app.patch('/api/sources/:id', async (c) => {
    const id = c.req.param('id');
    if (!listAdapters().some((a) => a.id === id)) return c.json({ error: 'Source not found.' }, 404);
    const body = z.object({ enabled: z.boolean() }).parse(await c.req.json());
    const disabled = new Set(getSetting('sources.disabled'));
    if (body.enabled) disabled.delete(id);
    else disabled.add(id);
    setSetting('sources.disabled', [...disabled]);
    return c.json(sourcesDto());
  });

  app.get('/api/search', (c) => c.json(getSetting('search')));

  app.put('/api/search', async (c) => {
    const body = z.object({ terms: z.array(z.string().max(100)).max(20), region: z.string().max(100) }).parse(await c.req.json());
    const next = { terms: [...new Set(body.terms.map((t) => t.trim()).filter(Boolean))], region: body.region.trim() };
    setSetting('search', next);
    return c.json(next);
  });

  app.get('/api/schedule', (c) => c.json(getSchedule()));

  app.put('/api/schedule', async (c) => {
    const body = z.object({ intervalHours: z.number().min(1).max(168).optional(), paused: z.boolean().optional() }).parse(await c.req.json());
    return c.json(updateSchedule(body));
  });

  app.post('/api/fetch', (c) => {
    const run = startFetchRun('manual');
    if (!run) return c.json({ started: false, runId: getActiveRunId() });
    return c.json({ started: true, runId: run.runId });
  });

  app.get('/api/runs', (c) => c.json(listRuns(20)));

  // ---- Language model

  app.get('/api/llm', (c) => c.json({ settings: llmDto(), available: isLlmAvailable() }));

  app.put('/api/llm', async (c) => {
    const body = llmSchema.parse(await c.req.json());
    const result = await saveLlmSettings(body);
    return c.json({ ...result, settings: llmDto() }, result.saved ? 200 : 400);
  });

  app.post('/api/llm/test', async (c) => c.json(await probe()));

  // ---- Matching control

  app.post('/api/matching/pause', (c) => {
    setSetting('matching.paused', true);
    publish({ type: 'queue.changed' });
    return c.json({ paused: true });
  });

  app.post('/api/matching/resume', (c) => {
    setSetting('matching.paused', false);
    publish({ type: 'queue.changed' });
    return c.json({ paused: false });
  });

  app.get('/api/matching/stale', (c) => c.json(planRescore({ dryRun: true })));
  app.post('/api/matching/rescore-stale', (c) => c.json(planRescore()));

  // ---- Notifications

  app.get('/api/notifications', (c) => c.json(notificationDto()));

  app.put('/api/notifications', async (c) => {
    const body = z
      .object({
        enabled: z.boolean().optional(),
        server: z.string().trim().url().max(300).optional(),
        threshold: z.number().min(0).max(100).optional(),
        windowSeconds: z.number().min(0).max(3600).optional(),
        appBaseUrl: z.string().trim().url().max(300).optional(),
      })
      .parse(await c.req.json());
    const { appBaseUrl, ...patch } = body;
    if (appBaseUrl) setSetting('app.baseUrl', appBaseUrl.replace(/\/+$/, ''));
    saveNotificationSettings(patch);
    return c.json(notificationDto());
  });

  app.post('/api/notifications/regenerate', (c) => {
    regenerateTopic();
    return c.json(notificationDto());
  });

  app.post('/api/notifications/test', async (c) => {
    const result = await sendTestNotification();
    return c.json(result, result.ok ? 200 : 502);
  });

  // ---- Applications

  app.get('/api/applications', (c) => c.json(listApplications()));

  app.post('/api/applications', async (c) => {
    const body = z.object({ postingId: z.string() }).parse(await c.req.json());
    const created = createApplication(body.postingId);
    return created ? c.json(created) : c.json({ error: 'Posting not found.' }, 404);
  });

  app.get('/api/applications/:id/events', (c) => c.json(listApplicationEvents(c.req.param('id'))));

  app.patch('/api/applications/:id', async (c) => {
    const body = z
      .object({ stage: ApplicationStage.optional(), notes: z.string().max(20_000).nullable().optional(), interviewAt: z.string().nullable().optional() })
      .parse(await c.req.json());
    try {
      const updated = updateApplication(c.req.param('id'), body);
      return updated ? c.json(updated) : c.json({ error: 'Application not found.' }, 404);
    } catch (err) {
      if (err instanceof z.ZodError) throw err;
      return c.json({ error: errorMessage(err) }, 400);
    }
  });

  app.delete('/api/applications/:id', (c) =>
    removeApplication(c.req.param('id')) ? c.json({ ok: true }) : c.json({ error: 'Application not found.' }, 404),
  );

  // ---- Activity, logs, backups

  app.get('/api/activity', (c) => c.json(activityDto()));

  app.post('/api/activity/tasks/:id/retry', (c) => {
    const ok = retryTask(Number(c.req.param('id')));
    return ok ? c.json({ ok: true }) : c.json({ error: 'The task is not in the failed state.' }, 400);
  });

  app.get('/api/logs', (c) => {
    const level = c.req.query('level');
    const rows = (
      level && ['info', 'warn', 'error'].includes(level)
        ? sqlite.prepare('SELECT id, level, message, created_at FROM logs WHERE level = ? ORDER BY id DESC LIMIT 300').all(level)
        : sqlite.prepare('SELECT id, level, message, created_at FROM logs ORDER BY id DESC LIMIT 300').all()
    ) as Array<{ id: number; level: LogDto['level']; message: string; created_at: string }>;
    return c.json(rows.map((r): LogDto => ({ id: r.id, level: r.level, message: r.message, createdAt: r.created_at })));
  });

  app.get('/api/backups', (c) => c.json({ backups: listBackups(), settings: getSetting('backup') }));

  app.post('/api/backups', async (c) => c.json(await createBackup()));

  app.get('/api/backups/:name', (c) => {
    const name = c.req.param('name');
    const path = backupPath(name);
    if (!path) return c.json({ error: 'Backup not found.' }, 404);
    return new Response(Readable.toWeb(createReadStream(path)) as ReadableStream, {
      headers: {
        'Content-Type': 'application/vnd.sqlite3',
        'Content-Length': String(statSync(path).size),
        'Content-Disposition': `attachment; filename="${name}"`,
      },
    });
  });

  app.all('/api/*', (c) => c.json({ error: 'Not found.' }, 404));

  // ---- Built client

  const clientDir = opts.clientDir ? resolve(opts.clientDir) : null;
  if (clientDir && existsSync(join(clientDir, 'index.html'))) {
    const index = readFileSync(join(clientDir, 'index.html'));
    app.get('*', (c) => {
      const path = normalize(join(clientDir, decodeURIComponent(new URL(c.req.url).pathname)));
      const type = MIME[extname(path)];
      if (path.startsWith(clientDir) && type && existsSync(path) && statSync(path).isFile()) {
        const immutable = path.includes(`${join(clientDir, 'assets')}`);
        return new Response(new Uint8Array(readFileSync(path)), {
          headers: { 'Content-Type': type, 'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache' },
        });
      }
      // Every other path is a client route.
      return new Response(new Uint8Array(index), { headers: { 'Content-Type': MIME['.html']!, 'Cache-Control': 'no-cache' } });
    });
  }

  return app;
}
