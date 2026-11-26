import { randomInt } from 'node:crypto';
import { sqlite } from '../kernel/db';
import { nowIso } from '../kernel/clock';
import { errorMessage, log } from '../kernel/logger';
import { getSetting, setSetting, type SettingsMap } from '../kernel/settings';
import { enqueue, registerHandler } from '../kernel/tasks';

type NotificationSettings = SettingsMap['notifications'];

const BASE32 = 'abcdefghijklmnopqrstuvwxyz234567';
const TOPIC_PREFIX = 'sieve-';
const TOPIC_RANDOM_LENGTH = 24;

/**
 * Makes a topic name that a third party cannot guess.
 * 24 characters from a 32-character alphabet are 120 random bits from a cryptographic source.
 */
export function generateTopic(): string {
  let out = TOPIC_PREFIX;
  for (let i = 0; i < TOPIC_RANDOM_LENGTH; i++) out += BASE32[randomInt(BASE32.length)];
  return out;
}

export function getNotificationSettings(): NotificationSettings {
  return getSetting('notifications');
}

export function subscribeUrl(s: NotificationSettings): string | null {
  return s.topic ? `${s.server.replace(/\/+$/, '')}/${s.topic}` : null;
}

/** Saves the settings. The first time notifications are enabled, the system generates the topic. */
export function saveNotificationSettings(
  patch: Partial<Pick<NotificationSettings, 'enabled' | 'server' | 'threshold' | 'windowSeconds'>>,
): NotificationSettings {
  const current = getSetting('notifications');
  const next: NotificationSettings = { ...current, ...patch };
  next.threshold = Math.max(0, Math.min(100, Math.round(next.threshold)));
  next.windowSeconds = Math.max(0, Math.min(3600, Math.round(next.windowSeconds)));
  const server = next.server.trim().replace(/\/+$/, '');
  const url = new URL(server);
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('The server address must start with http or https.');
  next.server = server;
  if (next.enabled && !next.topic) next.topic = generateTopic();
  setSetting('notifications', next);
  return next;
}

/** Replaces the topic. Later notifications go only to the new topic. */
export function regenerateTopic(): NotificationSettings {
  const next = { ...getSetting('notifications'), topic: generateTopic() };
  setSetting('notifications', next);
  return next;
}

export interface NtfyMessage {
  title: string;
  body: string;
  click?: string;
  tags?: string[];
  priority?: number;
}

type FetchLike = typeof fetch;
let fetchImpl: FetchLike = (...a) => fetch(...a);

export function setNotificationFetchForTests(f: FetchLike | null): void {
  fetchImpl = f ?? ((...a) => fetch(...a));
}

/** ntfy takes the title and the link as HTTP headers. Headers allow only Latin-1, so other text is RFC 2047 encoded. */
function headerValue(text: string): string {
  return /^[\x20-\x7e]*$/.test(text) ? text : `=?UTF-8?B?${Buffer.from(text, 'utf8').toString('base64')}?=`;
}

export async function publishToNtfy(s: NotificationSettings, message: NtfyMessage): Promise<void> {
  if (!s.topic) throw new Error('No notification topic exists.');
  const headers: Record<string, string> = { Title: headerValue(message.title), 'Content-Type': 'text/plain; charset=utf-8' };
  if (message.click) headers.Click = message.click;
  if (message.tags?.length) headers.Tags = message.tags.join(',');
  if (message.priority) headers.Priority = String(message.priority);
  const res = await fetchImpl(`${s.server}/${s.topic}`, { method: 'POST', headers, body: message.body, signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`ntfy server returned HTTP ${res.status}`);
}

export async function sendTestNotification(): Promise<{ ok: boolean; error?: string }> {
  const s = getSetting('notifications');
  if (!s.topic) return { ok: false, error: 'Enable notifications first. The system then generates a topic.' };
  try {
    await publishToNtfy(s, { title: 'sieve test', body: 'Notifications work.', tags: ['white_check_mark'] });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

/**
 * Called when a posting gets its first score.
 * A posting that qualifies is marked, and one batch task collects all marked postings after the window.
 */
export function queueNotification(postingId: string, total: number): void {
  const s = getSetting('notifications');
  if (!s.enabled || !s.topic || total < s.threshold) return;
  const r = sqlite
    .prepare('UPDATE matches SET notify_queued_at = ? WHERE posting_id = ? AND notified_at IS NULL AND notify_queued_at IS NULL')
    .run(nowIso(), postingId);
  if (r.changes > 0) enqueue('notify', 'batch', { delayMs: s.windowSeconds * 1000 });
}

interface PendingRow {
  id: string;
  title: string;
  company: string;
  total_score: number;
}

/** Builds the message. It holds only title, company, score, and a link. No CV, profile, or assessment text. */
export function buildMessage(rows: PendingRow[], baseUrl: string): NtfyMessage {
  const base = baseUrl.replace(/\/+$/, '');
  if (rows.length === 1) {
    const r = rows[0]!;
    return { title: `${r.total_score} · ${r.title}`, body: r.company, click: `${base}/jobs?id=${r.id}`, tags: ['briefcase'] };
  }
  const top = rows.slice(0, 5).map((r) => `${r.total_score} · ${r.title} · ${r.company}`);
  const rest = rows.length > 5 ? [`and ${rows.length - 5} more`] : [];
  return { title: `${rows.length} new matches`, body: [...top, ...rest].join('\n'), click: `${base}/jobs`, tags: ['briefcase'] };
}

export function registerNotifyHandler(): void {
  registerHandler('notify', async (ctx) => {
    const s = getSetting('notifications');
    const rows = sqlite
      .prepare(
        `SELECT p.id, p.title, p.company, m.total_score FROM matches m JOIN postings p ON p.id = m.posting_id
         WHERE m.notify_queued_at IS NOT NULL AND m.notified_at IS NULL AND m.total_score IS NOT NULL
         ORDER BY m.total_score DESC`,
      )
      .all() as PendingRow[];
    if (rows.length === 0) return;
    const ids = rows.map((r) => r.id);
    const mark = sqlite.prepare('UPDATE matches SET notified_at = ? WHERE posting_id = ?');
    const record = sqlite.prepare('INSERT INTO notifications (posting_ids, state, attempts, error, created_at, sent_at) VALUES (?, ?, ?, ?, ?, ?)');
    const finish = (state: 'sent' | 'failed', error: string | null) => {
      const now = nowIso();
      sqlite.transaction(() => {
        for (const id of ids) mark.run(now, id);
        record.run(JSON.stringify(ids), state, ctx.attempt, error, now, state === 'sent' ? now : null);
      })();
    };
    if (!s.enabled || !s.topic) {
      // The user disabled notifications during the window. Nothing is sent.
      sqlite.prepare('UPDATE matches SET notify_queued_at = NULL WHERE notified_at IS NULL').run();
      return;
    }
    try {
      await publishToNtfy(s, buildMessage(rows, getSetting('app.baseUrl')));
      finish('sent', null);
    } catch (err) {
      if (ctx.isLastAttempt) {
        // The final failure is recorded for the activity view. Each posting still counts as handled, so it notifies at most once.
        finish('failed', errorMessage(err));
        log('error', `notification failed after ${ctx.attempt} attempts: ${errorMessage(err)}`);
        return;
      }
      throw err;
    }
  });
}
