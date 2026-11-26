// A stub of an OpenAI-compatible model server for the end-to-end tests.
// It answers by the name of the requested JSON schema, so the matching pipeline runs without a real model.
// It also serves a plain page for each seeded posting link, so no test request leaves this machine.
import { createServer } from 'node:http';

const answers = {
  posting_facts: {
    requiredSkills: ['TypeScript'],
    optionalSkills: [],
    seniority: null,
    workArrangement: 'remote',
    location: { city: null, country: null },
    requiredLanguages: [],
    salary: null,
    summary: 'Stub facts.',
  },
  judgment: { skillsFit: 70, experienceFit: 60, preferenceFit: 50, matchedSkills: ['TypeScript'], missingSkills: [], assessment: 'Stub assessment for you.' },
};

/** Starts the stub. Resolves with the server and a count of the calls for each schema name. */
export function startStubLlm(port) {
  const calls = { posting_facts: 0, judgment: 0, other: 0 };
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      if (req.url.startsWith('/job/')) {
        res.setHeader('Content-Type', 'text/html');
        return res.end('<!doctype html><title>Stub posting</title><p>Stub posting page.</p>');
      }
      res.setHeader('Content-Type', 'application/json');
      if (req.url.startsWith('/v1/models')) return res.end(JSON.stringify({ data: [{ id: 'stub' }] }));
      if (!req.url.startsWith('/v1/chat/completions')) {
        // For example the icon request of a posting page.
        res.statusCode = 404;
        return res.end(JSON.stringify({ error: { message: 'not found' } }));
      }
      let name;
      try {
        name = JSON.parse(body).response_format?.json_schema?.name;
      } catch {
        name = undefined;
      }
      if (!answers[name]) {
        calls.other++;
        res.statusCode = 400;
        return res.end(JSON.stringify({ error: { message: `the stub has no answer for schema ${name}` } }));
      }
      const answer = { ...answers[name] };
      // Each judgment gets another score, so the list has a clear order.
      if (name === 'judgment') answer.skillsFit = 20 + ((calls.judgment * 7) % 75);
      calls[name]++;
      setTimeout(() => res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(answer) } }] })), 20);
    });
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve({ server, calls }));
  });
}
