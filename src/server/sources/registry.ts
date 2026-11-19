import type { SourceAdapter } from './adapter';
import { arbeitnowAdapter } from './adapters/arbeitnow';
import { jobindexAdapter } from './adapters/jobindex';
import { linkedinAdapter } from './adapters/linkedin';
import { remoteokAdapter } from './adapters/remoteok';
import { remotiveAdapter } from './adapters/remotive';

/** One line for each source. A new board is one new file and one new line here. */
const ADAPTERS: SourceAdapter[] = [jobindexAdapter, linkedinAdapter, remotiveAdapter, arbeitnowAdapter, remoteokAdapter];

export function listAdapters(): SourceAdapter[] {
  return ADAPTERS;
}

export function getAdapter(id: string): SourceAdapter | undefined {
  return ADAPTERS.find((a) => a.id === id);
}
