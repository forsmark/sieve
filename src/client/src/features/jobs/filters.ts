import type { PostingQuery } from '../../../../shared/api';
import type { TriageStatus } from '../../../../shared/schemas';

/**
 * The search parameters of `/jobs`. The names match the API query, so a URL is easy to read
 * and the same filters can be sent to `/api/postings` unchanged. Defaults are left out of the URL.
 */
export interface JobSearch {
  /** The selected posting. The ntfy link opens `/jobs?id=<postingId>`. */
  id?: string;
  /** Comma-separated triage statuses, or "all". Absent means "new,saved". */
  status?: string;
  source?: string;
  work?: 'remote' | 'hybrid' | 'onsite';
  minScore?: number;
  tag?: string;
  maxAgeDays?: number;
  q?: string;
  unread?: true;
  showExcluded?: true;
  showDuplicates?: true;
  sort?: 'newest';
}

export const TRIAGE_STATUSES: TriageStatus[] = ['new', 'saved', 'applied', 'dismissed'];
export const DEFAULT_STATUSES: TriageStatus[] = ['new', 'saved'];
const WORK = ['remote', 'hybrid', 'onsite'] as const;

function str(v: unknown): string | undefined {
  if (typeof v === 'number') return String(v);
  if (typeof v !== 'string') return undefined;
  const t = v.trim();
  return t ? t : undefined;
}

function num(v: unknown, min: number, max: number): number | undefined {
  const s = str(v);
  if (s === undefined) return undefined;
  const n = Number(s);
  if (!Number.isFinite(n)) return undefined;
  const r = Math.round(n);
  return r > min && r <= max ? r : undefined;
}

function flag(v: unknown): true | undefined {
  return v === true || v === '1' || v === 'true' ? true : undefined;
}

/** Normalizes a status list: known values in a fixed order, "all" when every status is present. */
export function normalizeStatus(v: unknown): string | undefined {
  const s = str(v);
  if (!s) return undefined;
  if (s === 'all') return 'all';
  const parts = new Set(s.split(',').map((p) => p.trim()));
  const list = TRIAGE_STATUSES.filter((t) => parts.has(t));
  if (list.length === 0) return undefined;
  if (list.length === TRIAGE_STATUSES.length) return 'all';
  if (list.length === DEFAULT_STATUSES.length && DEFAULT_STATUSES.every((d) => list.includes(d))) return undefined;
  return list.join(',');
}

/** Reads untrusted search parameters into a valid `JobSearch`. Unknown and invalid values are dropped. */
export function parseJobSearch(raw: Record<string, unknown>): JobSearch {
  const out: JobSearch = {};
  const id = str(raw.id);
  if (id) out.id = id;
  const status = normalizeStatus(raw.status);
  if (status) out.status = status;
  const source = str(raw.source);
  if (source) out.source = source;
  const work = str(raw.work);
  if (work && (WORK as readonly string[]).includes(work)) out.work = work as JobSearch['work'];
  const minScore = num(raw.minScore, 0, 100);
  if (minScore !== undefined) out.minScore = minScore;
  const tag = str(raw.tag);
  if (tag) out.tag = tag;
  const age = num(raw.maxAgeDays, 0, 3650);
  if (age !== undefined) out.maxAgeDays = age;
  const q = str(raw.q);
  if (q) out.q = q;
  if (flag(raw.unread)) out.unread = true;
  if (flag(raw.showExcluded)) out.showExcluded = true;
  if (flag(raw.showDuplicates)) out.showDuplicates = true;
  if (raw.sort === 'newest') out.sort = 'newest';
  return out;
}

/** Turns a `JobSearch` into URL search parameters, in a stable order and without defaults. */
export function jobSearchToParams(s: JobSearch): URLSearchParams {
  const p = new URLSearchParams();
  const clean = parseJobSearch(s as Record<string, unknown>);
  const order: Array<keyof JobSearch> = [
    'q', 'status', 'source', 'work', 'minScore', 'tag', 'maxAgeDays', 'unread', 'showExcluded', 'showDuplicates', 'sort', 'id',
  ];
  for (const key of order) {
    const v = clean[key];
    if (v === undefined) continue;
    p.set(key, v === true ? '1' : String(v));
  }
  return p;
}

/** The API query for a search. The selection does not change the list, so it is not part of the query. */
export function toPostingQuery(s: JobSearch): PostingQuery {
  const q: PostingQuery = { status: s.status ?? DEFAULT_STATUSES.join(','), sort: s.sort ?? 'score' };
  if (s.source) q.source = s.source;
  if (s.work) q.work = s.work;
  if (s.minScore) q.minScore = s.minScore;
  if (s.tag) q.tag = s.tag;
  if (s.maxAgeDays) q.maxAgeDays = s.maxAgeDays;
  if (s.q) q.q = s.q;
  if (s.unread) q.unread = true;
  if (s.showExcluded) q.showExcluded = true;
  if (s.showDuplicates) q.showDuplicates = true;
  return q;
}

/** The triage statuses that a search shows. */
export function statusesOf(s: JobSearch): TriageStatus[] {
  if (s.status === 'all') return [...TRIAGE_STATUSES];
  if (!s.status) return [...DEFAULT_STATUSES];
  return TRIAGE_STATUSES.filter((t) => s.status!.split(',').includes(t));
}

/** True when any filter differs from the default view. Sort and selection do not count. */
export function hasActiveFilters(s: JobSearch): boolean {
  const { id: _id, sort: _sort, ...rest } = parseJobSearch(s as Record<string, unknown>);
  return Object.keys(rest).length > 0;
}

export function clearFilters(s: JobSearch): JobSearch {
  const out: JobSearch = {};
  if (s.sort) out.sort = s.sort;
  if (s.id) out.id = s.id;
  return out;
}

// ---- Router serialization: plain `key=value` pairs, no JSON quoting.

export function parseSearchString(search: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of new URLSearchParams(search.startsWith('?') ? search.slice(1) : search)) out[k] = v;
  return out;
}

export function stringifySearchObject(obj: Record<string, unknown>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null || v === '' || v === false) continue;
    p.set(k, v === true ? '1' : String(v));
  }
  const s = p.toString();
  return s ? `?${s}` : '';
}
