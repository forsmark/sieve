import { beforeEach, describe, expect, it } from 'vitest';
import { sqlite } from '../kernel/db';
import { whenIdle } from '../kernel/tasks';
import { ingestPosting } from '../ingestion/ingest';
import { registerMatchingHandlers } from '../matching/handlers';
import { saveProfileEdits } from '../profile/service';
import { FACTS, PROFILE, fakeClock, postingOf, raw, resetAll, stubLlm } from '../testing/helpers';
import { createApplication, getApplication, listApplicationEvents, listApplications, removeApplication, updateApplication } from './service';
import type { ApplicationStage } from '../../shared/schemas';

beforeEach(async () => {
  await resetAll();
  stubLlm();
  registerMatchingHandlers();
  saveProfileEdits(PROFILE);
});

function add(overrides: Parameters<typeof raw>[0] = {}): string {
  const r = ingestPosting('remotive', raw(overrides));
  if (r.status === 'invalid') throw new Error('invalid');
  return r.id;
}

describe('application service', () => {
  it('refuses a stage outside the five stages and keeps the earlier stage', () => {
    const id = add();
    createApplication(id);
    updateApplication(id, { stage: 'interview' });
    expect(() => updateApplication(id, { stage: 'hired' as ApplicationStage })).toThrow();
    expect(getApplication(id)!.stage).toBe('interview');
    expect(listApplicationEvents(id).map((e) => e.toStage)).toEqual(['applied', 'interview']);
  });

  it('records a stage change with the earlier stage, the new stage, and the time', () => {
    const clock = fakeClock();
    const id = add();
    createApplication(id);
    clock.advance(5 * 60_000);
    updateApplication(id, { stage: 'interview' });
    const events = listApplicationEvents(id);
    expect(events).toHaveLength(2);
    expect(events[1]).toMatchObject({ fromStage: 'applied', toStage: 'interview', createdAt: new Date(clock.now()).toISOString() });
  });

  it('copies the title, company, description, and facts of the posting when the application is created', async () => {
    const id = add();
    await whenIdle();
    const description = postingOf(id).description as string;
    expect(description).toContain('This role needs TypeScript and React.');
    createApplication(id);
    // A later change of the posting does not reach the copy.
    sqlite.prepare(`UPDATE postings SET title = 'Changed', company = 'Other', description = 'Other text.' WHERE id = ?`).run(id);
    sqlite.prepare('DELETE FROM posting_facts WHERE posting_id = ?').run(id);
    const { snapshot } = getApplication(id)!;
    expect(snapshot.title).toBe('Frontend Developer');
    expect(snapshot.company).toBe('Acme A/S');
    expect(snapshot.description).toBe(description);
    expect(snapshot.facts).toEqual(FACTS);
  });

  it('keeps the application and its copy when the original posting is deleted', () => {
    const id = add();
    const description = postingOf(id).description as string;
    createApplication(id);
    sqlite.prepare('DELETE FROM postings WHERE id = ?').run(id);
    const [application] = listApplications();
    expect(application).toMatchObject({ postingId: id, stage: 'applied', linkStatus: null });
    expect(application!.snapshot).toMatchObject({ title: 'Frontend Developer', company: 'Acme A/S', description });
  });

  it('returns a posting that was new to "saved", not "new", when the application is removed', () => {
    const id = add();
    expect(postingOf(id).triage_status).toBe('new');
    createApplication(id);
    expect(postingOf(id).triage_status).toBe('applied');
    expect(removeApplication(id)).toBe(true);
    expect(postingOf(id).triage_status).toBe('saved');
    expect(getApplication(id)).toBeNull();
  });
});
