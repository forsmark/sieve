// Prepares the test database through the server's own code. Run with tsx and the DATA_DIR of the test server.
//
//   seed.ts prepare <llm base url>   Before the server starts: disables every source, pauses the schedule,
//                                    and points the matching provider at the stub. So the server fetches no
//                                    job board and calls no real model.
//   seed.ts postings <link base url> Stores postings with the ingestion code, as a fetch run does.
//                                    Prints the result as JSON.
import { ingestPosting } from '../src/server/ingestion/ingest';
import { sqlite } from '../src/server/kernel/db';
import { setSetting } from '../src/server/kernel/settings';
import { listAdapters } from '../src/server/sources/registry';
import { updateSchedule } from '../src/server/sources/schedule';

const [mode, baseUrl] = process.argv.slice(2);
if (!process.env.DATA_DIR) throw new Error('Set DATA_DIR. The seed script must never open the default database.');
if (!baseUrl) throw new Error('Usage: seed.ts prepare|postings <base url>');

/** Distinct titles and companies, so the duplicate detection keeps all of them. */
const JOBS: Array<[title: string, company: string, location: string]> = [
  ['Frontend Developer', 'Aldergrove Systems', 'Copenhagen'],
  ['Backend Engineer', 'Birchwood Labs', 'Aarhus'],
  ['Data Analyst', 'Cedarline Analytics', 'Remote'],
  ['Site Reliability Engineer', 'Dunmore Cloud', 'Odense'],
  ['Mobile Developer', 'Elmhurst Apps', 'Copenhagen'],
  ['Security Specialist', 'Foxglove Security', 'Aalborg'],
  ['Product Designer', 'Greenfinch Studio', 'Remote'],
  ['Machine Learning Researcher', 'Hawthorn Research', 'Copenhagen'],
  ['Quality Assurance Tester', 'Ironbridge Software', 'Esbjerg'],
  ['Database Administrator', 'Juniper Data', 'Aarhus'],
  ['Embedded Firmware Programmer', 'Kestrel Devices', 'Odense'],
  ['Technical Writer', 'Larkspur Docs', 'Remote'],
];

if (mode === 'prepare') {
  setSetting(
    'sources.disabled',
    listAdapters().map((a) => a.id),
  );
  updateSchedule({ paused: true });
  setSetting('llm', { provider: 'local', baseUrl, model: 'stub', apiKey: '', claudeEffort: 'low' });
  console.log(JSON.stringify({ disabledSources: listAdapters().map((a) => a.id) }));
} else if (mode === 'postings') {
  const day = 86_400_000;
  const results = JOBS.map(([title, company, location], i) => {
    const externalId = `e2e-${i + 1}`;
    const result = ingestPosting('e2e', {
      externalId,
      title,
      company,
      location,
      // The links point at the stub server. The host "localhost" is rejected by the ingestion code.
      url: `${baseUrl}/job/${externalId}`,
      description: `${company} looks for a ${title} in ${location}. `.repeat(8),
      postedAt: new Date(Date.now() - ((i + 1) * day) / 4).toISOString(),
    });
    return { title, ...result };
  });
  console.log(JSON.stringify(results));
} else {
  throw new Error(`Unknown mode: ${mode}`);
}

// The ingestion code schedules a queue check in a microtask. Close the database after it ran.
setImmediate(() => sqlite.close());
