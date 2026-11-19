import { sqlite, parseJson } from './db';
import { nowIso } from './clock';

/** Typed settings with defaults. Every setting is one JSON value in the settings table. */
export interface SettingsMap {
  'search': { terms: string[]; region: string };
  'sources.disabled': string[];
  'llm': {
    provider: 'local' | 'claude-code';
    baseUrl: string;
    model: string;
    apiKey: string;
    claudeEffort: 'low' | 'medium';
  };
  'matching.paused': boolean;
  'notifications': {
    enabled: boolean;
    server: string;
    topic: string | null;
    threshold: number;
    windowSeconds: number;
  };
  'app.baseUrl': string;
  'backup': { intervalHours: number; keep: number; lastAt: string | null };
}

export const SETTING_DEFAULTS: SettingsMap = {
  'search': { terms: [], region: '' },
  'sources.disabled': [],
  'llm': { provider: 'local', baseUrl: 'http://localhost:11434', model: 'gemma3:27b', apiKey: '', claudeEffort: 'low' },
  'matching.paused': false,
  'notifications': { enabled: false, server: 'https://ntfy.sh', topic: null, threshold: 80, windowSeconds: 120 },
  'app.baseUrl': 'http://localhost:3000',
  'backup': { intervalHours: 6, keep: 10, lastAt: null },
};

export function getSetting<K extends keyof SettingsMap>(key: K): SettingsMap[K] {
  const row = sqlite.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
  const fallback = SETTING_DEFAULTS[key];
  if (!row) return structuredClone(fallback);
  const stored = parseJson<SettingsMap[K] | null>(row.value, null);
  if (stored === null) return structuredClone(fallback);
  if (typeof fallback === 'object' && !Array.isArray(fallback) && fallback !== null) {
    return { ...(fallback as object), ...(stored as object) } as SettingsMap[K];
  }
  return stored;
}

export function setSetting<K extends keyof SettingsMap>(key: K, value: SettingsMap[K]): void {
  sqlite
    .prepare(
      `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    )
    .run(key, JSON.stringify(value), nowIso());
}
