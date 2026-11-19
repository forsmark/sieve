import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FetchContext, HttpResult, RawPosting } from '../adapter';
import { parseRemoteOk, remoteokAdapter, repairMojibake } from './remoteok';

const fixture = readFileSync(new URL('./__fixtures__/remoteok.json', import.meta.url), 'utf8');

function fakeCtx(body: string, status = 200) {
  const urls: string[] = [];
  const get = vi.fn(async (url: string): Promise<HttpResult> => {
    urls.push(url);
    return { status, ok: status < 400, url, text: async () => body, json: async <T>() => JSON.parse(body) as T };
  });
  const ctx: FetchContext = { http: { get }, signal: new AbortController().signal, log: () => {} };
  return { ctx, get, urls };
}

async function collect(it: AsyncIterable<RawPosting>): Promise<RawPosting[]> {
  const out: RawPosting[] = [];
  for await (const p of it) out.push(p);
  return out;
}

afterEach(() => vi.restoreAllMocks());

describe('parseRemoteOk', () => {
  it('skips the legal notice and parses the jobs', () => {
    const postings = parseRemoteOk(JSON.parse(fixture));
    expect(postings).toHaveLength(4);
    expect(postings[0]).toMatchObject({
      externalId: '1137713',
      // The feed double-encodes the dash; the parser repairs it.
      title: 'Senior Software Engineer — Kubernetes Control Plane',
      company: 'Buoyant',
      location: 'Remote',
      url: 'https://remoteOK.com/remote-jobs/remote-senior-software-engineer-kubernetes-control-plane-buoyant-1137713',
      postedAt: '2026-11-09T22:00:02.000Z',
    });
    expect(postings[2]!.location).toBe('Remote — Warsaw');
  });

  it('skips an item without a title', () => {
    const data = JSON.parse(fixture);
    data[1].position = '';
    const postings = parseRemoteOk(data);
    expect(postings).toHaveLength(3);
    expect(postings.map((p) => p.externalId)).not.toContain('1137713');
  });

  it('leaves correct text alone', () => {
    expect(repairMojibake('Søren — Café')).toBe('Søren — Café');
  });
});

describe('remoteokAdapter.search', () => {
  it('fetches once through ctx.http and filters by term', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const { ctx, urls } = fakeCtx(fixture);
    const all = await collect(remoteokAdapter.search({ terms: [], region: '' }, ctx));
    expect(all).toHaveLength(4);
    const golang = await collect(remoteokAdapter.search({ terms: ['golang'], region: '' }, ctx));
    expect(golang.map((p) => p.externalId)).toEqual(['1137713']);
    expect(urls).toEqual(['https://remoteok.com/api', 'https://remoteok.com/api']);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('throws with the status when the response is not ok', async () => {
    const { ctx } = fakeCtx('', 403);
    await expect(collect(remoteokAdapter.search({ terms: [], region: '' }, ctx))).rejects.toThrow(/403/);
  });
});
