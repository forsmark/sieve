import type { PostingFacts, Preferences, StructuredProfile, Weights } from '../../shared/schemas';
import { normalizeCompany } from '../ingestion/normalize';

/**
 * The code rules of the match. No language model runs here.
 * The same input always gives the same result.
 */

export type SoftViolation = { kind: 'language'; detail: string } | { kind: 'work_arrangement'; detail: string };

export interface ConstraintResult {
  /** Null when no hard constraint excludes the posting. */
  excludedReason: string | null;
  softViolations: SoftViolation[];
}

/** Points that one violated soft constraint removes from the total. */
export const SOFT_PENALTY: Record<SoftViolation['kind'], number> = { language: 30, work_arrangement: 15 };

/** Location fit when the posting matches a commutable location. */
const COMMUTABLE_SCORE = 80;
/** Location fit when the posting states no location. Unknown must not punish hard. */
const UNKNOWN_LOCATION_SCORE = 70;

function norm(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function placeMatches(entries: string[], place: { city: string | null; country: string | null }): boolean {
  const city = place.city ? norm(place.city) : '';
  const country = place.country ? norm(place.country) : '';
  return entries.some((entry) => {
    const e = norm(entry);
    if (!e) return false;
    // "Greater Copenhagen" matches "Copenhagen", and "Denmark" matches every city in Denmark.
    return (city !== '' && (city.includes(e) || e.includes(city))) || (country !== '' && (country === e || e.includes(country)));
  });
}

export type LocationClass = 'accepted' | 'commutable' | 'remote' | 'unknown' | 'outside' | 'no_preference';

export function classifyLocation(facts: PostingFacts, prefs: Preferences): LocationClass {
  if (prefs.locations.length === 0 && prefs.commutableLocations.length === 0) return 'no_preference';
  if (facts.workArrangement === 'remote') return 'remote';
  if (!facts.location.city && !facts.location.country) return 'unknown';
  if (placeMatches(prefs.locations, facts.location)) return 'accepted';
  if (placeMatches(prefs.commutableLocations, facts.location)) return 'commutable';
  return 'outside';
}

export function locationScore(facts: PostingFacts, prefs: Preferences): number {
  switch (classifyLocation(facts, prefs)) {
    case 'accepted':
    case 'remote':
    case 'no_preference':
      return 100;
    case 'commutable':
      return COMMUTABLE_SCORE;
    case 'unknown':
      return UNKNOWN_LOCATION_SCORE;
    case 'outside':
      return 0;
  }
}

/**
 * Evaluates the constraints for one posting.
 * An unknown fact never excludes a posting and never causes a penalty.
 */
export function evaluateConstraints(posting: { company: string }, facts: PostingFacts, profile: StructuredProfile, prefs: Preferences): ConstraintResult {
  const softViolations: SoftViolation[] = [];

  const company = normalizeCompany(posting.company);
  if (company && prefs.excludedCompanies.some((c) => normalizeCompany(c) === company)) {
    return { excludedReason: 'excluded company', softViolations };
  }

  if (prefs.locationMode === 'hard' && classifyLocation(facts, prefs) === 'outside') {
    const place = [facts.location.city, facts.location.country].filter(Boolean).join(', ');
    return { excludedReason: `location: ${place}`, softViolations };
  }

  const known = new Set(profile.languages.map((l) => norm(l)));
  const missing = facts.requiredLanguages.filter((l) => norm(l) && !known.has(norm(l)));
  // Without any language in the profile, the system cannot judge this constraint.
  if (missing.length > 0 && known.size > 0) {
    if (prefs.languageMode === 'hard') return { excludedReason: `language: ${missing.join(', ')}`, softViolations };
    softViolations.push({ kind: 'language', detail: missing.join(', ') });
  }

  if (prefs.workArrangements.length > 0 && facts.workArrangement !== null && !prefs.workArrangements.includes(facts.workArrangement)) {
    if (prefs.workArrangementMode === 'hard') return { excludedReason: `work arrangement: ${facts.workArrangement}`, softViolations };
    softViolations.push({ kind: 'work_arrangement', detail: facts.workArrangement });
  }

  return { excludedReason: null, softViolations };
}

export interface DimensionScores {
  skills: number;
  experience: number;
  preferences: number;
  location: number;
}

/** Weighted mean of the four dimension scores, minus one fixed penalty for each violated soft constraint. */
export function totalScore(scores: DimensionScores, weights: Weights, softViolations: SoftViolation[]): number {
  const sum = weights.skills + weights.experience + weights.preferences + weights.location;
  if (sum <= 0) return 0;
  const mean =
    (scores.skills * weights.skills + scores.experience * weights.experience + scores.preferences * weights.preferences + scores.location * weights.location) /
    sum;
  const penalty = softViolations.reduce((p, v) => p + SOFT_PENALTY[v.kind], 0);
  return Math.max(0, Math.min(100, Math.round(mean - penalty)));
}
