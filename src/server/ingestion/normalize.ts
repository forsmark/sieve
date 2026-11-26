import { createHash } from 'node:crypto';
import type { RawPosting } from '../sources/adapter';

const COMPANY_SUFFIXES = /\b(a\/s|aps|as|ab|oy|bv|sa|sl|ltd|limited|inc|gmbh|llc|co|corporation|corp|group|plc)\b\.?/gi;
const SENIORITY_WORDS = /\b(senior|junior|lead|sr|jr|staff|principal|associate|mid|mid-level|head of)\b\.?/gi;

const ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&apos;': "'",
  '&nbsp;': ' ',
};

export function decodeEntities(text: string): string {
  return text
    .replace(/&(amp|lt|gt|quot|apos|nbsp|#39);/g, (m) => ENTITIES[m] ?? m)
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)));
}

/** Removes markup and keeps paragraph breaks. */
export function htmlToText(input: string): string {
  if (!/[<&]/.test(input))
    return input
      .replace(/\r\n?/g, '\n')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  const text = input
    .replace(/\r\n?/g, '\n')
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<li[^>]*>/gi, '\n- ')
    .replace(/<\/(p|div|h[1-6]|ul|ol|section|article|tr|table)>/gi, '\n\n')
    .replace(/<[^>]+>/g, '');
  return decodeEntities(text)
    .replace(/[ \t ]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function normalizeCompany(name: string): string {
  return name.toLowerCase().replace(COMPANY_SUFFIXES, '').replace(/[.,&]/g, ' ').replace(/\s+/g, ' ').trim();
}

export function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(SENIORITY_WORDS, '')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[^\p{L}\p{N}\s+#]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function fingerprint(title: string, company: string): string {
  return `${normalizeTitle(title)}|${normalizeCompany(company)}`;
}

/** The share of words of the shorter title that the longer title also has. */
export const FUZZY_TITLE_OVERLAP = 0.6;

/** True when two titles at the same company very likely describe the same job. */
export function isSimilarTitle(a: string, b: string): boolean {
  const na = normalizeTitle(a);
  const nb = normalizeTitle(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  const wa = new Set(na.split(' ').filter((w) => w.length > 1));
  const wb = new Set(nb.split(' ').filter((w) => w.length > 1));
  const [small, large] = wa.size <= wb.size ? [wa, wb] : [wb, wa];
  // A one-word title such as "developer" matches too many different roles.
  if (small.size < 2) return false;
  let overlap = 0;
  for (const w of small) if (large.has(w)) overlap++;
  if (overlap === small.size) return true;
  return overlap / small.size >= FUZZY_TITLE_OVERLAP && small.size >= 3;
}

export interface NormalizedPosting {
  externalId: string;
  title: string;
  company: string;
  location: string | null;
  url: string;
  description: string | null;
  postedAt: string | null;
  companyKey: string;
  fingerprint: string;
}

const MAX_DESCRIPTION = 20_000;

/** Returns the common shape, or null when a required field is missing or the link is not valid. */
export function normalizePosting(raw: RawPosting): NormalizedPosting | null {
  const title = decodeEntities(String(raw.title ?? ''))
    .replace(/\s+/g, ' ')
    .trim();
  const company = decodeEntities(String(raw.company ?? ''))
    .replace(/\s+/g, ' ')
    .trim();
  const externalId = String(raw.externalId ?? '').trim();
  if (!title || !company || !externalId) return null;
  let url: URL;
  try {
    url = new URL(String(raw.url ?? ''));
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (url.hostname === 'localhost' || url.hostname === 'example.com') return null;

  let description = raw.description ? htmlToText(raw.description) : null;
  if (description !== null && description.length === 0) description = null;
  if (description && description.length > MAX_DESCRIPTION) description = description.slice(0, MAX_DESCRIPTION);

  let postedAt: string | null = null;
  if (raw.postedAt) {
    const d = new Date(raw.postedAt);
    if (!Number.isNaN(d.getTime())) postedAt = d.toISOString();
  }
  const location = raw.location ? decodeEntities(raw.location).replace(/\s+/g, ' ').trim() || null : null;

  return {
    externalId,
    title,
    company,
    location,
    url: url.toString(),
    description,
    postedAt,
    companyKey: normalizeCompany(company),
    fingerprint: fingerprint(title, company),
  };
}

export function sha(text: string): string {
  return createHash('sha256').update(text).digest('hex').slice(0, 16);
}
