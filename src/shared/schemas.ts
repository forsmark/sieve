import { z } from 'zod';

// ---- Posting facts: the output of the extract step. It does not depend on the profile.

export const Seniority = z.enum(['junior', 'mid', 'senior', 'lead']);
export const WorkArrangement = z.enum(['remote', 'hybrid', 'onsite']);

export const PostingFacts = z.object({
  requiredSkills: z.array(z.string()),
  optionalSkills: z.array(z.string()),
  seniority: Seniority.nullable(),
  workArrangement: WorkArrangement.nullable(),
  location: z.object({ city: z.string().nullable(), country: z.string().nullable() }),
  requiredLanguages: z.array(z.string()),
  salary: z.object({ min: z.number().nullable(), max: z.number().nullable(), currency: z.string(), period: z.string() }).nullable(),
  summary: z.string(),
});
export type PostingFacts = z.infer<typeof PostingFacts>;

// ---- Judgment: the output of the judge step.

const Score = z.number().int().min(0).max(100);

export const Judgment = z.object({
  skillsFit: Score,
  experienceFit: Score,
  preferenceFit: Score,
  matchedSkills: z.array(z.string()),
  missingSkills: z.array(z.string()),
  assessment: z.string().min(1),
});
export type Judgment = z.infer<typeof Judgment>;

// ---- Candidate profile

export const SkillLevel = z.enum(['basic', 'working', 'strong', 'expert']);

export const StructuredProfile = z.object({
  headline: z.string(),
  skills: z.array(z.object({ name: z.string().min(1), level: SkillLevel, years: z.number().min(0).nullable() })),
  roles: z.array(
    z.object({
      title: z.string(),
      company: z.string(),
      start: z.string().nullable(),
      end: z.string().nullable(),
      summary: z.string(),
    }),
  ),
  totalYears: z.number().min(0).nullable(),
  languages: z.array(z.string()),
  education: z.array(z.object({ degree: z.string(), institution: z.string(), year: z.string().nullable() })),
});
export type StructuredProfile = z.infer<typeof StructuredProfile>;

export const EMPTY_PROFILE: StructuredProfile = {
  headline: '',
  skills: [],
  roles: [],
  totalYears: null,
  languages: [],
  education: [],
};

// ---- Preferences

export const ConstraintMode = z.enum(['hard', 'soft']);

export const Weights = z.object({
  skills: z.number().min(0).max(100),
  experience: z.number().min(0).max(100),
  preferences: z.number().min(0).max(100),
  location: z.number().min(0).max(100),
});
export type Weights = z.infer<typeof Weights>;

export const DEFAULT_WEIGHTS: Weights = { skills: 40, experience: 25, preferences: 20, location: 15 };

export const Preferences = z.object({
  locations: z.array(z.string()),
  commutableLocations: z.array(z.string()),
  locationMode: ConstraintMode,
  workArrangements: z.array(WorkArrangement),
  workArrangementMode: ConstraintMode,
  languageMode: ConstraintMode,
  seniority: z.enum(['any', 'junior', 'mid', 'senior', 'lead']),
  minSalary: z.number().min(0).nullable(),
  salaryCurrency: z.string(),
  wantedTech: z.array(z.string()),
  unwantedTech: z.array(z.string()),
  excludedCompanies: z.array(z.string()),
  notes: z.string(),
  weights: Weights.refine((w) => w.skills + w.experience + w.preferences + w.location > 0, 'At least one weight must be above 0'),
  autoDismiss: z.object({ enabled: z.boolean(), threshold: Score }),
});
export type Preferences = z.infer<typeof Preferences>;

export const DEFAULT_PREFERENCES: Preferences = {
  locations: [],
  commutableLocations: [],
  locationMode: 'soft',
  workArrangements: [],
  workArrangementMode: 'soft',
  languageMode: 'soft',
  seniority: 'any',
  minSalary: null,
  salaryCurrency: 'DKK',
  wantedTech: [],
  unwantedTech: [],
  excludedCompanies: [],
  notes: '',
  weights: DEFAULT_WEIGHTS,
  autoDismiss: { enabled: false, threshold: 20 },
};

// ---- Status values

export const TriageStatus = z.enum(['new', 'saved', 'dismissed', 'applied']);
export type TriageStatus = z.infer<typeof TriageStatus>;

export const MatchState = z.enum(['waiting', 'in_progress', 'scored', 'excluded', 'failed']);
export type MatchState = z.infer<typeof MatchState>;

export const ApplicationStage = z.enum(['applied', 'interview', 'offer', 'rejected', 'withdrawn']);
export type ApplicationStage = z.infer<typeof ApplicationStage>;
export const APPLICATION_STAGES: ApplicationStage[] = ['applied', 'interview', 'offer', 'rejected', 'withdrawn'];

export const LinkStatus = z.enum(['unchecked', 'active', 'expired', 'unknown']);
export type LinkStatus = z.infer<typeof LinkStatus>;

/** Score bands for the interface. Each band has a label, so color is never the only signal. */
export function scoreBand(score: number | null): { band: 'high' | 'medium' | 'low' | 'none'; label: string } {
  if (score === null) return { band: 'none', label: 'No score' };
  if (score >= 75) return { band: 'high', label: 'Strong match' };
  if (score >= 50) return { band: 'medium', label: 'Possible match' };
  return { band: 'low', label: 'Weak match' };
}
