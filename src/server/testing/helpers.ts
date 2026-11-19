import type { z } from 'zod';
import { resetDb, sqlite } from '../kernel/db';
import { setClock } from '../kernel/clock';
import { setLaneBlocked, whenIdle } from '../kernel/tasks';
import { setLlmClientForTests, setWritingClientForTests } from '../llm';
import type { HealthResult, LlmClient } from '../llm/types';
import type { Judgment, PostingFacts, StructuredProfile } from '../../shared/schemas';
import type { RawPosting } from '../sources/adapter';

/** A clock that tests move by hand. */
export function fakeClock(start = Date.parse('2026-06-01T10:00:00.000Z')) {
  let now = start;
  setClock(() => now);
  return {
    advance(ms: number) {
      now += ms;
    },
    now: () => now,
  };
}

export async function resetAll(): Promise<void> {
  await whenIdle();
  resetDb();
  setClock(null);
  setLaneBlocked('llm', false);
  setLaneBlocked('network', false);
  setLlmClientForTests(null);
  setWritingClientForTests(null);
}

export const FACTS: PostingFacts = {
  requiredSkills: ['TypeScript', 'React'],
  optionalSkills: ['AWS'],
  seniority: 'senior',
  workArrangement: 'hybrid',
  location: { city: 'Copenhagen', country: 'Denmark' },
  requiredLanguages: [],
  salary: null,
  summary: 'A frontend role.',
};

export const JUDGMENT: Judgment = {
  skillsFit: 80,
  experienceFit: 70,
  preferenceFit: 60,
  matchedSkills: ['TypeScript'],
  missingSkills: ['React'],
  assessment: 'You fit the stack. You lack React depth.',
};

export const PROFILE: StructuredProfile = {
  headline: 'Frontend developer',
  skills: [{ name: 'TypeScript', level: 'strong', years: 5 }],
  roles: [{ title: 'Developer', company: 'Acme', start: '2020', end: null, summary: 'Builds web applications.' }],
  totalYears: 6,
  languages: ['English', 'Danish'],
  education: [],
};

export interface StubLlm {
  client: LlmClient;
  calls: { extract: number; judge: number; derive: number; letter: number; analysis: number };
  /** The user text of the last analysis call. */
  lastAnalysisInput: string;
  analysis: () => unknown;
  /** The user text of the last cover letter call. */
  lastLetterInput: string;
  letter: () => unknown;
  /** Replace to change what the stub returns or to make it throw. */
  facts: (userText: string) => unknown;
  judgment: (userText: string) => unknown;
  profile: () => unknown;
  healthResult: HealthResult;
}

/** A language model stub. It answers by schema name and counts the calls of each kind. */
export function stubLlm(): StubLlm {
  const stub: StubLlm = {
    calls: { extract: 0, judge: 0, derive: 0, letter: 0, analysis: 0 },
    lastAnalysisInput: '',
    analysis: () => ({
      verdict: 'consider',
      summary: 'You meet the main requirements. One gap decides the outcome.',
      strengths: [{ point: 'TypeScript', evidence: 'Eight years of TypeScript in the CV.' }],
      gaps: [{ point: 'Kubernetes', severity: 'significant', mitigation: 'State your Docker experience.' }],
      unknowns: ['What is the salary range?'],
      positioning: ['Lead with the logistics applications.'],
      scores: { skills: 95, experience: 90, preferences: 70 },
    }),
    lastLetterInput: '',
    letter: () => ({ language: 'English', letter: `Dear hiring team,\n\n${'I build web applications with TypeScript. '.repeat(4)}\n\nBest regards,\nJane Doe` }),
    facts: () => FACTS,
    judgment: () => JUDGMENT,
    profile: () => PROFILE,
    healthResult: { reachable: true, modelAvailable: true },
    client: {
      provider: 'local',
      model: 'stub-model',
      async generateObject<T>(schema: z.ZodType<T>, messages: Array<{ role: string; content: string }>, opts?: { name?: string }): Promise<T> {
        const user = messages.filter((m) => m.role === 'user').map((m) => m.content).join('\n');
        let raw: unknown;
        if (opts?.name === 'posting_facts') {
          stub.calls.extract++;
          raw = stub.facts(user);
        } else if (opts?.name === 'judgment') {
          stub.calls.judge++;
          raw = stub.judgment(user);
        } else if (opts?.name === 'match_analysis') {
          stub.calls.analysis++;
          stub.lastAnalysisInput = user;
          raw = stub.analysis();
        } else if (opts?.name === 'cover_letter') {
          stub.calls.letter++;
          stub.lastLetterInput = user;
          raw = stub.letter();
        } else {
          stub.calls.derive++;
          raw = stub.profile();
        }
        return schema.parse(raw);
      },
      health: async () => stub.healthResult,
    },
  };
  // The same stub serves matching calls and writing calls.
  setLlmClientForTests(stub.client);
  setWritingClientForTests(stub.client);
  return stub;
}

const LONG = 'This role needs TypeScript and React. '.repeat(10);

export function raw(overrides: Partial<RawPosting> = {}): RawPosting {
  return {
    externalId: 'job-1',
    title: 'Frontend Developer',
    company: 'Acme A/S',
    location: 'Copenhagen',
    url: 'https://jobs.test/job-1',
    description: LONG,
    postedAt: '2026-05-30T08:00:00.000Z',
    ...overrides,
  };
}

export function matchOf(id: string) {
  return sqlite.prepare('SELECT * FROM matches WHERE posting_id = ?').get(id) as Record<string, any> | undefined;
}

export function postingOf(id: string) {
  return sqlite.prepare('SELECT * FROM postings WHERE id = ?').get(id) as Record<string, any>;
}

export function tasksOf(kind?: string) {
  return (kind ? sqlite.prepare('SELECT * FROM tasks WHERE kind = ? ORDER BY id').all(kind) : sqlite.prepare('SELECT * FROM tasks ORDER BY id').all()) as Array<Record<string, any>>;
}
