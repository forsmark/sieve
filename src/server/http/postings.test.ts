import { beforeEach, describe, expect, it } from 'vitest';
import { setSetting } from '../kernel/settings';
import { whenIdle } from '../kernel/tasks';
import { ingestPosting } from '../ingestion/ingest';
import { registerMatchingHandlers } from '../matching/handlers';
import { savePreferences, saveProfileEdits } from '../profile/service';
import type { SourceAdapter } from '../sources/adapter';
import { startFetchRun } from '../sources/runner';
import { PROFILE, raw, resetAll, stubLlm } from '../testing/helpers';
import { DEFAULT_PREFERENCES } from '../../shared/schemas';
import { applyTriage, getCounts, listPostings, markRead } from './postings';

beforeEach(async () => {
  await resetAll();
  stubLlm();
  registerMatchingHandlers();
  saveProfileEdits(PROFILE);
});

function add(overrides: Parameters<typeof raw>[0]): string {
  const r = ingestPosting('remotive', raw(overrides));
  if (r.status === 'invalid') throw new Error('invalid');
  return r.id;
}

const ids = (q: Parameters<typeof listPostings>[0]) => listPostings(q).items.map((i) => i.id);

describe('default visibility', () => {
  it('hides dismissed, excluded, and duplicate postings by default', async () => {
    savePreferences({ ...DEFAULT_PREFERENCES, excludedCompanies: ['Blocked Corp'] });
    const kept = add({ externalId: '1', title: 'Frontend Developer', company: 'Acme A/S', url: 'https://jobs.test/1' });
    const dismissed = add({ externalId: '2', title: 'Data Engineer', company: 'Other A/S', url: 'https://jobs.test/2' });
    const excluded = add({ externalId: '3', title: 'Backend Developer', company: 'Blocked Corp', url: 'https://jobs.test/3' });
    const dup = ingestPosting('linkedin', raw({ externalId: 'li', title: 'Frontend Developer', company: 'Acme A/S', url: 'https://li.test/1' }));
    if (dup.status !== 'duplicate') throw new Error('expected a duplicate');
    applyTriage([dismissed], 'dismiss');
    await whenIdle();

    // Each hidden posting exists, in the state that hides it.
    const everything = listPostings({ status: 'all', showExcluded: true, showDuplicates: true }).items;
    expect(everything.map((i) => i.id).sort()).toEqual([kept, dismissed, excluded, dup.id].sort());
    expect(everything.find((i) => i.id === dismissed)!.triageStatus).toBe('dismissed');
    expect(everything.find((i) => i.id === excluded)!.match).toMatchObject({ state: 'excluded', excludedReason: 'excluded company' });
    expect(everything.find((i) => i.id === dup.id)!.duplicateOf).toBe(kept);

    // The default list shows only the primary posting that is neither dismissed nor excluded.
    const list = listPostings({});
    expect(list.items.map((i) => i.id)).toEqual([kept]);
    expect(list.total).toBe(1);

    // Each group comes back with its own switch.
    expect(ids({ status: 'new,saved,dismissed' }).sort()).toEqual([kept, dismissed].sort());
    expect(ids({ showExcluded: true }).sort()).toEqual([kept, excluded].sort());
    expect(ids({ showDuplicates: true }).sort()).toEqual([kept, dup.id].sort());
  });
});

describe('unread tracking', () => {
  it('marks the postings that a fetch run adds as unread', async () => {
    const before = add({ externalId: 'old', title: 'Data Engineer', company: 'Old A/S', url: 'https://jobs.test/old' });
    markRead([before], true);
    setSetting('search', { terms: ['react'], region: '' });
    const fake: SourceAdapter = {
      id: 'fake',
      name: 'fake',
      supports: { keywords: true, region: true },
      rate: { minDelayMs: 0, maxConcurrent: 1 },
      async *search() {
        yield raw({ externalId: 'a', title: 'Frontend Developer', company: 'Acme A/S', url: 'https://jobs.test/a' });
        yield raw({ externalId: 'b', title: 'Backend Developer', company: 'Beta A/S', url: 'https://jobs.test/b' });
      },
    };
    await startFetchRun('manual', { adapters: [fake] })!.done;
    await whenIdle();

    const items = listPostings({}).items;
    expect(items).toHaveLength(3);
    const added = items.filter((i) => i.source === 'fake');
    expect(added.map((i) => i.title).sort()).toEqual(['Backend Developer', 'Frontend Developer']);
    for (const item of added) expect(item.unread).toBe(true);
    // The posting the user read before the run stays read.
    expect(items.find((i) => i.id === before)!.unread).toBe(false);
    expect(getCounts().unread).toBe(2);
  });
});
