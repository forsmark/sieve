// End-to-end test runner: `pnpm e2e`.
//
// It builds the client, starts a private server with a fresh database, and drives the real interface
// in headless Chrome. It uses no real network and no real model:
// - the matching provider is a stub server (stub-llm.mjs),
// - the CV digest runs a fake `claude` command (bin/claude) that is first on the server's PATH,
// - the postings come from the server's ingestion code (seed.ts), and every source is disabled.
//
// Options (environment variables):
//   E2E_SKIP_BUILD=1    use the existing build in dist/
//   E2E_PORT, E2E_STUB_PORT, E2E_CHROME_PORT    other ports than 3411, 3412, 9344
//   E2E_CHROME          another browser command than google-chrome
import { spawn, spawnSync } from 'node:child_process';
import { createWriteStream, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assert, assertEqual, createApi, createReporter, launchBrowser, sleep, until } from './driver.mjs';
import { startStubLlm } from './stub-llm.mjs';
import { runFirstStart } from './scenario-first-start.mjs';
import { runKeyboardTriage } from './scenario-keyboard-triage.mjs';
import { runSwipe } from './scenario-swipe.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const PORT = Number(process.env.E2E_PORT ?? 3411);
const STUB_PORT = Number(process.env.E2E_STUB_PORT ?? 3412);
const CHROME_PORT = Number(process.env.E2E_CHROME_PORT ?? 9344);
/** The whole run stops after this time, so a hung browser or server cannot block a pipeline. */
const RUN_LIMIT_MS = 4 * 60_000;

const base = `http://127.0.0.1:${PORT}`;
const stubUrl = `http://127.0.0.1:${STUB_PORT}`;
const started = Date.now();
const t = createReporter();
/** Functions that stop what the run started. They run in reverse order, also after a failure. */
const cleanups = [];
let cleaned = false;

async function cleanup() {
  if (cleaned) return;
  cleaned = true;
  for (const fn of cleanups.reverse()) {
    try {
      await fn();
    } catch (err) {
      console.log(`cleanup problem: ${err.message}`);
    }
  }
}

function portIsFree(port) {
  return new Promise((done) => {
    const probe = createServer();
    probe.once('error', () => done(false));
    probe.listen(port, '127.0.0.1', () => probe.close(() => done(true)));
  });
}

/** Runs a command to its end. Throws with the output when it fails. */
function runToEnd(label, command, args, env) {
  const r = spawnSync(command, args, { cwd: root, env, encoding: 'utf8', timeout: 120_000 });
  if (r.error) throw new Error(`${label} did not start: ${r.error.message}`);
  if (r.status !== 0) throw new Error(`${label} failed (exit ${r.status}):\n${(r.stdout + r.stderr).trim().split('\n').slice(-25).join('\n')}`);
  return r.stdout;
}

async function stopProcess(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise((r) => child.once('exit', r));
  child.kill('SIGTERM');
  await Promise.race([exited, sleep(4000)]);
  if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
}

async function main() {
  for (const [name, port] of [
    ['server', PORT],
    ['stub model', STUB_PORT],
    ['Chrome debugging', CHROME_PORT],
  ]) {
    if (!(await portIsFree(port))) throw new Error(`Port ${port} for the ${name} is in use. Stop the other process or set another port.`);
  }

  if (process.env.E2E_SKIP_BUILD !== '1') {
    console.log('Building the client (pnpm build)');
    runToEnd('pnpm build', 'pnpm', ['build'], process.env);
  }

  const work = mkdtempSync(join(tmpdir(), 'sieve-e2e-'));
  cleanups.push(() => rmSync(work, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }));
  const dataDir = join(work, 'data');
  const chromeDir = join(work, 'chrome');
  const claudeLog = join(work, 'claude-calls.log');
  const serverLog = join(work, 'server.log');
  mkdirSync(dataDir);
  mkdirSync(chromeDir);
  writeFileSync(claudeLog, '');

  // The server and the seed script share this environment. The fake claude command comes first on the PATH.
  const env = {
    ...process.env,
    NODE_ENV: 'production',
    PORT: String(PORT),
    HOST: '127.0.0.1',
    DATA_DIR: dataDir,
    PATH: `${join(here, 'bin')}${delimiter}${process.env.PATH}`,
    E2E_CLAUDE_LOG: claudeLog,
  };
  delete env.AUTH_PASSWORD;
  delete env.VITEST;
  const tsx = (script, ...args) => [process.execPath, ['--import', 'tsx', script, ...args]];

  // Before the server starts: no source may fetch, the schedule is paused, and the matching provider is the stub.
  runToEnd('seed.ts prepare', ...tsx('e2e/seed.ts', 'prepare', stubUrl), env);

  const stub = await startStubLlm(STUB_PORT);
  cleanups.push(
    () =>
      new Promise((r) => {
        stub.server.closeAllConnections();
        stub.server.close(r);
      }),
  );

  const [node, serverArgs] = tsx('src/server/index.ts');
  const server = spawn(node, serverArgs, { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
  const logStream = createWriteStream(serverLog);
  server.stdout.pipe(logStream);
  server.stderr.pipe(logStream);
  cleanups.push(() => stopProcess(server));
  const serverTail = () => {
    try {
      return readFileSync(serverLog, 'utf8').trim().split('\n').slice(-15).join('\n');
    } catch {
      return '';
    }
  };
  try {
    await until(
      async () => {
        if (server.exitCode !== null) throw new Error(`the server stopped with exit code ${server.exitCode}`);
        return (await fetch(`${base}/api/health`)).ok;
      },
      { timeout: 20_000, interval: 150, message: `the server on ${base}` },
    );
  } catch (err) {
    throw new Error(`${err.message}\nServer log:\n${serverTail()}`);
  }

  const api = createApi(base);

  t.section('Setup');
  await t.check('setup: PUT /api/llm selects the stub model server', async () => {
    const r = await api.put('/api/llm', { provider: 'local', baseUrl: stubUrl, model: 'stub', apiKey: '', claudeEffort: 'low' });
    assert(r.saved && r.health.reachable, `the settings were not saved: ${JSON.stringify(r)}`);
    assertEqual([r.settings.provider, r.settings.baseUrl, r.settings.model], ['local', stubUrl, 'stub'], 'stored settings');
  });
  await t.check('setup: every source is disabled and the schedule is paused', async () => {
    const [sources, schedule] = await Promise.all([api.get('/api/sources'), api.get('/api/schedule')]);
    assert(sources.length > 0, 'GET /api/sources returned no source');
    assertEqual(
      sources.filter((s) => s.enabled).map((s) => s.id),
      [],
      'enabled sources',
    );
    assertEqual(schedule.paused, true, 'schedule paused');
  });
  const seeded = await t.check('setup: 12 postings are stored through the ingestion code', async () => {
    const results = JSON.parse(runToEnd('seed.ts postings', ...tsx('e2e/seed.ts', 'postings', stubUrl), env));
    assertEqual(
      results.map((r) => r.status),
      Array(12).fill('new'),
      'ingestion results',
    );
    const list = await api.get('/api/postings?status=all&limit=50');
    assertEqual(list.total, 12, 'GET /api/postings total');
  });
  if (!seeded) return;

  const page = await launchBrowser({ port: CHROME_PORT, userDataDir: chromeDir });
  cleanups.push(() => page.close());

  const ctx = { page, api, t, base, claudeLog };
  await runFirstStart(ctx);
  await runKeyboardTriage(ctx);
  await runSwipe(ctx);

  t.section('After the scenarios');
  await t.check('matching: the stub model answered the extraction and the judgment of each posting', async () => {
    assert(stub.calls.posting_facts >= 12 && stub.calls.judgment >= 12, `calls of the stub: ${JSON.stringify(stub.calls)}`);
    assertEqual(stub.calls.other, 0, 'calls with an unknown schema');
  });
  await t.check('network: no fetch run started, so no job board was contacted', async () => {
    assertEqual(await api.get('/api/runs'), [], 'GET /api/runs');
    const sources = await api.get('/api/sources');
    assertEqual(
      sources.filter((s) => s.enabled).map((s) => s.id),
      [],
      'enabled sources',
    );
  });
  await t.check('browser: no uncaught exception, console error, or failed request', async () => {
    assertEqual([...new Set(page.problems)], [], 'problems in the page');
  });
  if (t.failed.length > 0) console.log(`\nServer log (last lines):\n${serverTail()}`);
}

const watchdog = setTimeout(async () => {
  console.log(`FAIL  the run did not finish within ${RUN_LIMIT_MS / 1000} seconds`);
  await cleanup();
  process.exit(1);
}, RUN_LIMIT_MS);
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, async () => {
    await cleanup();
    process.exit(130);
  });
}

let crashed = false;
try {
  await main();
} catch (err) {
  crashed = true;
  console.log(`FAIL  the run stopped: ${err.message}`);
} finally {
  clearTimeout(watchdog);
  await cleanup();
}

const failed = t.failed.length + (crashed ? 1 : 0);
const seconds = ((Date.now() - started) / 1000).toFixed(1);
console.log(`\n${t.results.length} checks, ${t.results.length - t.failed.length} passed, ${failed} failed, ${seconds} s`);
process.exit(failed > 0 ? 1 : 0);
