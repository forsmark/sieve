const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Short age such as "5m", "3h", "2d", "4w". */
export function shortAge(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return '';
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  const d = Math.max(0, now - t);
  if (d < HOUR) return `${Math.max(1, Math.round(d / MINUTE))}m`;
  if (d < DAY) return `${Math.round(d / HOUR)}h`;
  if (d < 14 * DAY) return `${Math.round(d / DAY)}d`;
  if (d < 120 * DAY) return `${Math.round(d / (7 * DAY))}w`;
  return `${Math.round(d / (30 * DAY))}mo`;
}

/** Long relative time such as "5 minutes ago" or "in 2 hours". */
export function relativeTime(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return 'never';
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  const diff = t - now;
  const abs = Math.abs(diff);
  const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
  if (abs < MINUTE) return diff < 0 ? 'just now' : 'in less than a minute';
  if (abs < HOUR) return rtf.format(Math.round(diff / MINUTE), 'minute');
  if (abs < DAY) return rtf.format(Math.round(diff / HOUR), 'hour');
  return rtf.format(Math.round(diff / DAY), 'day');
}

export function dateTime(iso: string | null | undefined): string {
  if (!iso) return '';
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return '';
  return t.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

export function dateOnly(iso: string | null | undefined): string {
  if (!iso) return '';
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return '';
  return t.toLocaleDateString(undefined, { dateStyle: 'medium' });
}

export function bytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** Value for an `<input type="datetime-local">` from an ISO string, in local time. */
export function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function fromLocalInput(value: string): string | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export function sourceName(id: string): string {
  const names: Record<string, string> = {
    linkedin: 'LinkedIn',
    jobindex: 'Jobindex',
    remoteok: 'Remote OK',
    remotive: 'Remotive',
    arbeitnow: 'Arbeitnow',
  };
  return names[id] ?? id;
}

export function capitalize(s: string): string {
  return s ? s[0]!.toUpperCase() + s.slice(1) : s;
}
