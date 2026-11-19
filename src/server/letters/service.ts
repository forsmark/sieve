import { z } from 'zod';
import { sqlite, parseJson } from '../kernel/db';
import { nowIso } from '../kernel/clock';
import { publish } from '../kernel/events';
import { errorMessage } from '../kernel/logger';
import { enqueue, registerHandler } from '../kernel/tasks';
import { generateWritingObject } from '../llm';
import { getProfile } from '../profile/service';
import type { CoverLetterDto } from '../../shared/api';

interface LetterRow {
  posting_id: string;
  state: 'pending' | 'ready' | 'failed';
  text: string | null;
  language: string | null;
  instruction: string | null;
  error: string | null;
  model: string | null;
  edited: number;
  generated_at: string | null;
  updated_at: string;
}

export class CoverLetterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CoverLetterError';
  }
}

function toDto(r: LetterRow): CoverLetterDto {
  return {
    postingId: r.posting_id,
    state: r.state,
    text: r.text,
    language: r.language,
    instruction: r.instruction,
    error: r.error,
    model: r.model,
    edited: r.edited === 1,
    generatedAt: r.generated_at,
    updatedAt: r.updated_at,
  };
}

export function getCoverLetter(postingId: string): CoverLetterDto | null {
  const r = sqlite.prepare('SELECT * FROM cover_letters WHERE posting_id = ?').get(postingId) as LetterRow | undefined;
  return r ? toDto(r) : null;
}

/**
 * Starts the generation of the letter for one posting.
 * An earlier letter stays readable until the new one is ready.
 */
export function requestCoverLetter(postingId: string, instruction: string | null): CoverLetterDto {
  const posting = sqlite.prepare('SELECT id FROM postings WHERE id = ?').get(postingId);
  if (!posting) throw new CoverLetterError('Posting not found.');
  const profile = getProfile();
  if (!profile.cvText && !profile.effective) throw new CoverLetterError('Import a CV first. The letter is written from your CV.');
  const note = instruction?.trim() ? instruction.trim().slice(0, 2000) : null;
  sqlite
    .prepare(
      `INSERT INTO cover_letters (posting_id, state, instruction, updated_at) VALUES (?, 'pending', ?, ?)
       ON CONFLICT(posting_id) DO UPDATE SET state = 'pending', instruction = excluded.instruction, error = NULL, updated_at = excluded.updated_at`,
    )
    .run(postingId, note, nowIso());
  enqueue('cover_letter', postingId);
  publish({ type: 'posting.updated', postingId });
  return getCoverLetter(postingId)!;
}

/** Stores the text as the user edited it. */
export function saveCoverLetterText(postingId: string, text: string): CoverLetterDto | null {
  const r = sqlite
    .prepare(`UPDATE cover_letters SET text = ?, edited = 1, updated_at = ? WHERE posting_id = ? AND state != 'pending'`)
    .run(text, nowIso(), postingId);
  if (r.changes === 0) return null;
  publish({ type: 'posting.updated', postingId });
  return getCoverLetter(postingId);
}

export function deleteCoverLetter(postingId: string): boolean {
  const r = sqlite.prepare('DELETE FROM cover_letters WHERE posting_id = ?').run(postingId);
  if (r.changes > 0) publish({ type: 'posting.updated', postingId });
  return r.changes > 0;
}

/** Call once at startup. A generation that ran when the process stopped is queued again. */
export function recoverPendingLetters(): void {
  const rows = sqlite.prepare(`SELECT posting_id FROM cover_letters WHERE state = 'pending'`).all() as Array<{ posting_id: string }>;
  for (const r of rows) enqueue('cover_letter', r.posting_id);
}

const LetterOutput = z.object({
  language: z.string().min(2),
  letter: z.string().min(50),
});

const SYSTEM = `You write a cover letter for one job application. You get the job posting, the candidate's CV, the candidate's structured profile, and an optional instruction from the candidate.
Rules:
- Write in the language of the job posting. Put the English name of that language in "language", for example "Danish" or "English".
- Use only facts from the CV and the profile. Never invent an employer, a skill, a number, a degree, or a date.
- Connect two or three concrete facts from the CV to what the posting asks for. Be specific. Do not repeat the CV.
- Do not claim a skill that the posting asks for and the CV does not show. You may state interest in learning it.
- Tone: direct, confident, and plain. No clichés, no flattery of the company, no buzzwords.
- Length: 220 to 320 words, unless the instruction says otherwise.
- Form: plain text. A greeting line, three or four paragraphs with one empty line between them, a closing line, and the candidate's name from the CV. No address block, no date, no subject line, no Markdown, and no placeholder in brackets. When the CV has no name, end with the closing line only.
- The instruction from the candidate overrides the rules for tone, length, and content. It never permits invented facts.`;

interface Source {
  title: string;
  company: string;
  location: string | null;
  description: string | null;
  facts_json: string | null;
  snapshot_json: string | null;
}

export function registerCoverLetterHandler(): void {
  registerHandler('cover_letter', async (ctx) => {
    const postingId = ctx.subjectId;
    const row = sqlite.prepare('SELECT * FROM cover_letters WHERE posting_id = ?').get(postingId) as LetterRow | undefined;
    if (!row || row.state !== 'pending') return;
    const fail = (message: string) => {
      sqlite.prepare(`UPDATE cover_letters SET state = ?, error = ?, updated_at = ? WHERE posting_id = ?`).run(row.text ? 'ready' : 'failed', message, nowIso(), postingId);
      publish({ type: 'posting.updated', postingId });
    };
    const src = sqlite
      .prepare(
        `SELECT p.title, p.company, p.location, p.description, f.facts_json, a.snapshot_json FROM postings p
         LEFT JOIN posting_facts f ON f.posting_id = p.id LEFT JOIN applications a ON a.posting_id = p.id WHERE p.id = ?`,
      )
      .get(postingId) as Source | undefined;
    if (!src) return fail('The posting no longer exists.');
    const profile = getProfile();
    // The copy in the application keeps the description when the board removed the posting.
    const snapshot = parseJson<{ description?: string | null } | null>(src.snapshot_json, null);
    const description = src.description ?? snapshot?.description ?? null;
    const user = [
      `JOB POSTING\nTitle: ${src.title}\nCompany: ${src.company}\nLocation: ${src.location ?? 'not stated'}`,
      src.facts_json ? `Extracted facts (JSON): ${src.facts_json}` : '',
      `Description:\n${description ? description.slice(0, 10_000) : 'No description is available.'}`,
      `CANDIDATE CV\n${profile.cvText ? profile.cvText.slice(0, 24_000) : 'No CV text is available. Use the structured profile.'}`,
      profile.effective ? `STRUCTURED PROFILE (JSON, with the candidate's own corrections)\n${JSON.stringify(profile.effective)}` : '',
      `INSTRUCTION FROM THE CANDIDATE\n${row.instruction ?? 'None.'}`,
    ]
      .filter(Boolean)
      .join('\n\n');
    try {
      const { data, model } = await generateWritingObject(
        LetterOutput,
        [
          { role: 'system', content: SYSTEM },
          { role: 'user', content: user },
        ],
        { name: 'cover_letter' },
      );
      const now = nowIso();
      sqlite
        .prepare(
          `UPDATE cover_letters SET state = 'ready', text = ?, language = ?, error = NULL, model = ?, edited = 0, generated_at = ?, updated_at = ? WHERE posting_id = ?`,
        )
        .run(data.letter.trim(), data.language, model, now, now, postingId);
      publish({ type: 'posting.updated', postingId });
    } catch (err) {
      // The task does not retry. The user sees the cause and starts the generation again.
      fail(errorMessage(err));
    }
  });
}
