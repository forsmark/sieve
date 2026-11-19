import { beforeEach, describe, expect, it } from 'vitest';
import { setSetting } from '../kernel/settings';
import { setLaneBlocked, whenIdle } from '../kernel/tasks';
import { ingestPosting } from '../ingestion/ingest';
import { registerMatchingHandlers } from '../matching/handlers';
import { saveProfileEdits } from '../profile/service';
import { PROFILE, raw, resetAll, stubLlm, tasksOf, type StubLlm } from '../testing/helpers';
import { getCoverLetter, registerCoverLetterHandler, requestCoverLetter } from './service';

let stub: StubLlm;

beforeEach(async () => {
  await resetAll();
  stub = stubLlm();
  registerMatchingHandlers();
  registerCoverLetterHandler();
  saveProfileEdits(PROFILE);
});

function add(overrides: Parameters<typeof raw>[0] = {}): string {
  const r = ingestPosting('remotive', raw(overrides));
  if (r.status === 'invalid') throw new Error('invalid');
  return r.id;
}

describe('cover letter service', () => {
  it('runs a letter at once while matching is paused and the match queue holds work', async () => {
    setSetting('matching.paused', true);
    // The match lane is blocked too, so match work cannot finish while the letter runs.
    setLaneBlocked('llm', true);
    const id = add();
    add({ externalId: 'job-2', url: 'https://jobs.test/job-2', title: 'Backend Developer', company: 'Beta ApS' });
    requestCoverLetter(id, null);
    await whenIdle();
    expect(stub.calls.letter).toBe(1);
    expect(getCoverLetter(id)).toMatchObject({ state: 'ready', error: null });
    expect(getCoverLetter(id)!.text).toContain('Dear hiring team');
    // The match work still waits in the queue.
    expect(stub.calls.extract).toBe(0);
    expect(tasksOf('extract').filter((t) => t.state === 'pending')).toHaveLength(2);
  });

  it('keeps the earlier letter and reports the cause when a new generation fails', async () => {
    const id = add();
    requestCoverLetter(id, null);
    await whenIdle();
    const first = getCoverLetter(id)!;
    expect(first.state).toBe('ready');

    stub.letter = () => {
      throw new Error('The claude command timed out.');
    };
    requestCoverLetter(id, 'shorter');
    await whenIdle();
    const after = getCoverLetter(id)!;
    expect(after).toMatchObject({ state: 'ready', text: first.text, error: 'The claude command timed out.' });
  });
});
