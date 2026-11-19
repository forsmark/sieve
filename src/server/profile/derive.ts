import { generateWritingObject } from '../llm';
import { errorMessage } from '../kernel/logger';
import { registerHandler } from '../kernel/tasks';
import { StructuredProfile } from '../../shared/schemas';
import { planRescore } from '../matching/rescore';
import { getProfile, storeDeriveFailure, storeDerived } from './service';

const SYSTEM = `You turn a CV into a structured candidate profile.
Rules:
- Use only facts that the CV states. Do not invent skills, roles, or dates.
- skills: each technology, tool, method, or domain skill. level is basic, working, strong, or expert. years is the number of years of use, or null when the CV does not show it.
- roles: newest first. start and end are "YYYY" or "YYYY-MM". end is null for a current role. summary is one sentence.
- totalYears: total years of professional experience, or null when unclear.
- languages: spoken languages in English, for example "English", "Danish".
- headline: one line that describes the candidate.`;

export function registerDeriveHandler(): void {
  registerHandler('derive_profile', async () => {
    const profile = getProfile();
    if (!profile.hasCv || !profile.cvText) return;
    try {
      const { data } = await generateWritingObject(
        StructuredProfile,
        [
          { role: 'system', content: SYSTEM },
          { role: 'user', content: `CV:\n\n${profile.cvText.slice(0, 24_000)}` },
        ],
        { name: 'candidate_profile' },
      );
      storeDerived(data);
      // A new profile makes the stored scores stale. The planner queues the least work.
      planRescore();
    } catch (err) {
      // The client already retried. A missing or logged-out claude command also ends here, with its cause.
      // The user sees the failure at once and can retry or fill the profile by hand.
      storeDeriveFailure(errorMessage(err));
    }
  });
}
