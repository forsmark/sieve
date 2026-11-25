import { mkdirSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { sqlite } from '../kernel/db';
import { nowIso, nowMs } from '../kernel/clock';
import { errorMessage, log } from '../kernel/logger';
import { getSetting, setSetting } from '../kernel/settings';
import { config } from '../config';
import type { BackupDto } from '../../shared/api';

const NAME_PATTERN = /^sieve-\d{8}-\d{6}(-\d+)?\.db$/;

let dirOverride: string | null = null;

export function setBackupDirForTests(dir: string | null): void {
  dirOverride = dir;
}

export function backupDir(): string {
  const dir = dirOverride ?? join(config.dataDir, 'backups');
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function listBackups(): BackupDto[] {
  const dir = backupDir();
  return readdirSync(dir)
    .filter((name) => NAME_PATTERN.test(name))
    .map((name) => {
      const s = statSync(join(dir, name));
      return { name, size: s.size, createdAt: s.mtime.toISOString(), mtimeMs: s.mtimeMs };
    })
    // Newest first. The write time decides, because two backups of one second differ only by a suffix.
    .sort((a, b) => b.mtimeMs - a.mtimeMs || b.name.localeCompare(a.name))
    .map(({ mtimeMs: _mtimeMs, ...rest }) => rest);
}

/** Returns the full path of a stored backup, or null when the name is not a backup name. */
export function backupPath(name: string): string | null {
  if (!NAME_PATTERN.test(name)) return null;
  const path = join(backupDir(), name);
  try {
    statSync(path);
    return path;
  } catch {
    return null;
  }
}

/**
 * Writes a complete copy of the database and deletes the oldest copies beyond the retention count.
 * With `prune: false` the oldest copies stay, for a caller that may not go on to need the new one.
 */
export async function createBackup(opts: { prune?: boolean } = {}): Promise<BackupDto> {
  const dir = backupDir();
  const stamp = nowIso().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
  let name = `sieve-${stamp}.db`;
  for (let i = 1; backupPath(name); i++) name = `sieve-${stamp}-${i}.db`;
  await sqlite.backup(join(dir, name));
  setSetting('backup', { ...getSetting('backup'), lastAt: nowIso() });
  if (opts.prune !== false) pruneBackups();
  return listBackups().find((b) => b.name === name)!;
}

/** Deletes the oldest backups beyond the retention count. The newest backup always stays. */
export function pruneBackups(): void {
  const keep = getSetting('backup').keep;
  for (const old of listBackups().slice(Math.max(1, keep))) unlinkSync(join(backupDir(), old.name));
}

/** Creates a backup when the interval passed after the last one. A timer calls this. */
export async function backupIfDue(): Promise<boolean> {
  const s = getSetting('backup');
  const last = s.lastAt ? new Date(s.lastAt).getTime() : 0;
  if (nowMs() - last < s.intervalHours * 3_600_000) return false;
  try {
    await createBackup();
    return true;
  } catch (err) {
    log('error', `backup failed: ${errorMessage(err)}`);
    return false;
  }
}
