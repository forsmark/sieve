import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { sqlite } from '../kernel/db';
import { isoAfter, nowIso, nowMs } from '../kernel/clock';
import { config } from '../config';

export const SESSION_COOKIE = 'sieve_session';
const SESSION_DAYS = 30;
const MAX_ATTEMPTS = 5;
const WINDOW_MS = 15 * 60_000;

let passwordOverride: string | null | undefined;

/** Tests set a password without an environment variable. */
export function setPasswordForTests(password: string | null | undefined): void {
  passwordOverride = password;
  attempts.clear();
}

export function authPassword(): string | null {
  return passwordOverride !== undefined ? passwordOverride : config.authPassword;
}

export function authRequired(): boolean {
  return authPassword() !== null;
}

function hash(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Sessions are rows in the database, so a login survives a restart. Only the hash of the token is stored. */
export function createSession(): { token: string; maxAgeSeconds: number } {
  const token = randomBytes(32).toString('base64url');
  sqlite.prepare('INSERT INTO sessions (token_hash, expires_at) VALUES (?, ?)').run(hash(token), isoAfter(SESSION_DAYS * 86_400_000));
  sqlite.prepare('DELETE FROM sessions WHERE expires_at < ?').run(nowIso());
  return { token, maxAgeSeconds: SESSION_DAYS * 86_400 };
}

export function isValidSession(token: string | undefined): boolean {
  if (!token) return false;
  const row = sqlite.prepare('SELECT expires_at FROM sessions WHERE token_hash = ?').get(hash(token)) as { expires_at: string } | undefined;
  return !!row && row.expires_at > nowIso();
}

export function deleteSession(token: string | undefined): void {
  if (token) sqlite.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hash(token));
}

const attempts = new Map<string, number[]>();

/** Returns false when the client used all login attempts of the current window. */
export function allowLoginAttempt(client: string): boolean {
  const now = nowMs();
  const recent = (attempts.get(client) ?? []).filter((t) => now - t < WINDOW_MS);
  if (recent.length >= MAX_ATTEMPTS) {
    attempts.set(client, recent);
    return false;
  }
  recent.push(now);
  attempts.set(client, recent);
  return true;
}

export function clearLoginAttempts(client: string): void {
  attempts.delete(client);
}

export function checkPassword(candidate: string): boolean {
  const expected = authPassword();
  if (expected === null) return false;
  const a = createHash('sha256').update(candidate).digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b);
}
