import { chmodSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { subscribe, type AppEvent } from '../kernel/events';
import { getSetting } from '../kernel/settings';
import { enqueue, isLaneBlocked, registerHandler, whenIdle } from '../kernel/tasks';
import { resetAll, stubLlm, tasksOf } from '../testing/helpers';
import { CLAUDE_CODE_MODEL, WRITING_EFFORT, WRITING_MODEL, createClaudeCodeClient } from './claude-code';
import { createClient, generateObject, getClient, getWritingClient, probe, saveLlmSettings, setLlmClientForTests, setWritingClientForTests } from './index';
import { createOpenAiClient } from './openai';
import { InvalidOutputError, ProviderUnavailableError } from './types';

const Answer = z.object({ city: z.string(), score: z.number().int() });
const MESSAGES = [
  { role: 'system' as const, content: 'Extract.' },
  { role: 'user' as const, content: 'Job in Aarhus.' },
];

beforeEach(resetAll);

// ---- A stub of an OpenAI-compatible server

interface StubRequest {
  path: string;
  body: any;
  auth: string | undefined;
}

let server: Server;
let baseUrl: string;
let requests: StubRequest[] = [];
let respond: (req: StubRequest, n: number) => { status: number; content?: string; json?: unknown };

beforeAll(async () => {
  server = createServer((req, res) => {
    let data = '';
    req.on('data', (c) => (data += c));
    req.on('end', () => {
      const entry: StubRequest = { path: req.url ?? '', body: data ? JSON.parse(data) : null, auth: req.headers.authorization };
      requests.push(entry);
      const out = respond(entry, requests.filter((r) => r.path === entry.path).length);
      res.writeHead(out.status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(out.json ?? { choices: [{ message: { content: out.content ?? '' } }] }));
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => new Promise<void>((r) => server.close(() => r())));

beforeEach(() => {
  requests = [];
  respond = () => ({ status: 200, content: '{"city":"Aarhus","score":7}' });
});

describe('OpenAI-compatible client', () => {
  it('asks for schema output and returns the validated object', async () => {
    const client = createOpenAiClient({ baseUrl, model: 'test-model', apiKey: 'k1' });
    expect(await client.generateObject(Answer, MESSAGES, { name: 'answer' })).toEqual({ city: 'Aarhus', score: 7 });
    expect(requests).toHaveLength(1);
    const req = requests[0]!;
    expect(req.path).toBe('/v1/chat/completions');
    expect(req.auth).toBe('Bearer k1');
    expect(req.body.model).toBe('test-model');
    expect(req.body.response_format.type).toBe('json_schema');
    expect(req.body.response_format.json_schema.name).toBe('answer');
    expect(req.body.response_format.json_schema.schema.properties).toHaveProperty('city');
  });

  it('accepts a base URL with or without the /v1 suffix', async () => {
    await createOpenAiClient({ baseUrl: `${baseUrl}/v1/`, model: 'm' }).generateObject(Answer, MESSAGES);
    expect(requests[0]!.path).toBe('/v1/chat/completions');
  });

  it('retries with the validation error when the output does not fit the schema', async () => {
    respond = (_req, n) => ({ status: 200, content: n === 1 ? '{"city":"Aarhus"}' : '```json\n{"city":"Aarhus","score":3}\n```' });
    const client = createOpenAiClient({ baseUrl, model: 'm' });
    expect(await client.generateObject(Answer, MESSAGES)).toEqual({ city: 'Aarhus', score: 3 });
    expect(requests).toHaveLength(2);
    const retry = requests[1]!.body.messages.at(-1).content as string;
    expect(retry).toContain('rejected');
    expect(retry).toContain('score');
  });

  it('stops after the retry limit and reports the reason', async () => {
    respond = () => ({ status: 200, content: 'this is not JSON' });
    const client = createOpenAiClient({ baseUrl, model: 'm' });
    await expect(client.generateObject(Answer, MESSAGES, { maxAttempts: 3 })).rejects.toThrow(InvalidOutputError);
    expect(requests).toHaveLength(3);
  });

  it('falls back to JSON mode when the server rejects schema output', async () => {
    respond = (req) =>
      req.body.response_format.type === 'json_schema' ? { status: 400, json: { error: 'unsupported' } } : { status: 200, content: '{"city":"Odense","score":1}' };
    const client = createOpenAiClient({ baseUrl, model: 'm' });
    expect(await client.generateObject(Answer, MESSAGES)).toEqual({ city: 'Odense', score: 1 });
    expect(requests.map((r) => r.body.response_format.type)).toEqual(['json_schema', 'json_object']);
    expect(requests[1]!.body.messages.at(-1).content).toContain('JSON schema');
    // The client remembers the fallback for the next call.
    await client.generateObject(Answer, MESSAGES);
    expect(requests[2]!.body.response_format.type).toBe('json_object');
  });

  it('reports an unreachable endpoint and a server error as unavailable', async () => {
    await expect(createOpenAiClient({ baseUrl: 'http://127.0.0.1:1', model: 'm' }).generateObject(Answer, MESSAGES)).rejects.toThrow(ProviderUnavailableError);
    respond = () => ({ status: 503, json: {} });
    await expect(createOpenAiClient({ baseUrl, model: 'm' }).generateObject(Answer, MESSAGES)).rejects.toThrow(ProviderUnavailableError);
  });

  it('checks reachability and the model list in the health probe', async () => {
    respond = () => ({ status: 200, json: { data: [{ id: 'gemma3:27b' }] } });
    expect(await createOpenAiClient({ baseUrl, model: 'gemma3:27b' }).health()).toMatchObject({ reachable: true, modelAvailable: true });
    expect(await createOpenAiClient({ baseUrl, model: 'other' }).health()).toMatchObject({ reachable: true, modelAvailable: false });
    expect(await createOpenAiClient({ baseUrl: 'http://127.0.0.1:1', model: 'm' }).health()).toMatchObject({ reachable: false });
    expect(requests[0]!.path).toBe('/v1/models');
  });
});

// ---- A fake `claude` executable

const dir = mkdtempSync(join(tmpdir(), 'fake-claude-'));
const fake = join(dir, 'claude');
const logFile = join(dir, 'calls.jsonl');
const pidFile = join(dir, 'pid');
writeFileSync(
  fake,
  `#!/usr/bin/env node
const fs = require('fs');
const args = process.argv.slice(2);
if (args.includes('--version')) { console.log('9.9.9 (Claude Code)'); process.exit(0); }
let input = '';
process.stdin.on('data', (d) => (input += d));
process.stdin.on('end', () => {
  fs.appendFileSync(process.env.FAKE_CLAUDE_LOG, JSON.stringify({ args, input }) + '\\n');
  const n = fs.readFileSync(process.env.FAKE_CLAUDE_LOG, 'utf8').trim().split('\\n').length;
  const mode = process.env.FAKE_CLAUDE_MODE;
  if (mode === 'hang') { fs.writeFileSync(process.env.FAKE_CLAUDE_PID, String(process.pid)); setInterval(() => {}, 1000); return; }
  if (mode === 'auth') { console.log(JSON.stringify({ is_error: true, result: 'Not logged in · Please run /login' })); process.exit(1); }
  if (mode === 'bad-once' && n === 1) { console.log(JSON.stringify({ is_error: false, result: '', structured_output: { city: 'Aarhus' } })); return; }
  if (mode === 'text') { console.log(JSON.stringify({ is_error: false, result: '{"city":"Ribe","score":2}' })); return; }
  console.log(JSON.stringify({ is_error: false, result: '', structured_output: { city: 'Aarhus', score: 7 } }));
});
`,
);
chmodSync(fake, 0o755);

function calls(): Array<{ args: string[]; input: string }> {
  if (!existsSync(logFile)) return [];
  return readFileSync(logFile, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

describe('Claude Code client', () => {
  beforeEach(() => {
    writeFileSync(logFile, '');
    process.env.FAKE_CLAUDE_LOG = logFile;
    process.env.FAKE_CLAUDE_PID = pidFile;
    process.env.FAKE_CLAUDE_MODE = 'ok';
  });
  afterEach(() => {
    delete process.env.FAKE_CLAUDE_MODE;
  });

  it('starts the command with Fable 5.2 at medium effort for a writing task', async () => {
    const client = createClaudeCodeClient({ model: WRITING_MODEL, effort: WRITING_EFFORT, command: fake });
    expect(client.model).toBe('claude-fable-5-2');
    await client.generateObject(Answer, MESSAGES);
    const call = calls()[0]!;
    expect(call.args[call.args.indexOf('--model') + 1]).toBe('claude-fable-5-2');
    expect(call.args[call.args.indexOf('--effort') + 1]).toBe('medium');
  });

  it('uses Fable 5.2 for writing tasks when the matching provider is the local endpoint', () => {
    setWritingClientForTests(null);
    expect(getSetting('llm').provider).toBe('local');
    expect(getWritingClient()).toMatchObject({ provider: 'claude-code', model: 'claude-fable-5-2' });
  });

  it('starts the command with Haiku 5.5, the effort, a JSON schema, no tools, and the prompt on standard input', async () => {
    const client = createClaudeCodeClient({ effort: 'medium', command: fake });
    expect(await client.generateObject(Answer, MESSAGES)).toEqual({ city: 'Aarhus', score: 7 });
    const call = calls()[0]!;
    const arg = (flag: string) => call.args[call.args.indexOf(flag) + 1];
    expect(call.args[0]).toBe('-p');
    expect(arg('--model')).toBe('claude-haiku-5-5');
    expect(CLAUDE_CODE_MODEL).toBe('claude-haiku-5-5');
    expect(arg('--effort')).toBe('medium');
    expect(arg('--output-format')).toBe('json');
    expect(JSON.parse(arg('--json-schema')!).properties).toHaveProperty('score');
    // The real command rejects a schema with a `$schema` key.
    expect(JSON.parse(arg('--json-schema')!)).not.toHaveProperty('$schema');
    expect(arg('--tools')).toBe('');
    expect(call.args).toContain('--no-session-persistence');
    expect(arg('--system-prompt')).toBe('Extract.');
    // The posting text is on standard input and not in the argument list.
    expect(call.input).toBe('Job in Aarhus.');
    expect(call.args.join(' ')).not.toContain('Job in Aarhus.');
  });

  it('runs later match work through the command with Haiku 5.5 at medium effort after the user saves that selection', async () => {
    // The fake command is named "claude", so the client that the saved settings build finds it on the PATH.
    const path = process.env.PATH;
    process.env.PATH = `${dir}:${path ?? ''}`;
    try {
      expect(getSetting('llm')).toMatchObject({ provider: 'local', claudeEffort: 'low' });
      const result = await saveLlmSettings({ ...getSetting('llm'), provider: 'claude-code', claudeEffort: 'medium' });
      expect(result).toMatchObject({ saved: true, health: { reachable: true, detail: '9.9.9 (Claude Code)' } });
      expect(getSetting('llm')).toMatchObject({ provider: 'claude-code', claudeEffort: 'medium' });
      // The health check sent no model request.
      expect(calls()).toHaveLength(0);

      expect(getClient()).toMatchObject({ provider: 'claude-code', model: 'claude-haiku-5-5' });
      const out = await generateObject(Answer, MESSAGES, { name: 'posting_facts' });
      expect(out).toEqual({ data: { city: 'Aarhus', score: 7 }, provider: 'claude-code', model: 'claude-haiku-5-5' });
      expect(calls()).toHaveLength(1);
      const call = calls()[0]!;
      expect(call.args[call.args.indexOf('--model') + 1]).toBe('claude-haiku-5-5');
      expect(call.args[call.args.indexOf('--effort') + 1]).toBe('medium');
    } finally {
      process.env.PATH = path;
    }
  });

  it('passes the low effort level', async () => {
    await createClaudeCodeClient({ effort: 'low', command: fake }).generateObject(Answer, MESSAGES);
    const call = calls()[0]!;
    expect(call.args[call.args.indexOf('--effort') + 1]).toBe('low');
  });

  it('retries when the structured output does not fit the schema', async () => {
    process.env.FAKE_CLAUDE_MODE = 'bad-once';
    expect(await createClaudeCodeClient({ effort: 'low', command: fake }).generateObject(Answer, MESSAGES)).toEqual({ city: 'Aarhus', score: 7 });
    expect(calls()).toHaveLength(2);
    expect(calls()[1]!.input).toContain('rejected');
  });

  it('reads JSON from the result text when no structured output exists', async () => {
    process.env.FAKE_CLAUDE_MODE = 'text';
    expect(await createClaudeCodeClient({ effort: 'low', command: fake }).generateObject(Answer, MESSAGES)).toEqual({ city: 'Ribe', score: 2 });
  });

  it('stops the child process after the timeout', async () => {
    process.env.FAKE_CLAUDE_MODE = 'hang';
    const client = createClaudeCodeClient({ effort: 'low', command: fake, timeoutMs: 400 });
    await expect(client.generateObject(Answer, MESSAGES, { maxAttempts: 1 })).rejects.toThrow(/timed out/);
    const pid = Number(readFileSync(pidFile, 'utf8'));
    await new Promise((r) => setTimeout(r, 50));
    expect(() => process.kill(pid, 0)).toThrow();
  });

  it('reports a missing command as unavailable', async () => {
    const client = createClaudeCodeClient({ effort: 'low', command: join(dir, 'does-not-exist') });
    await expect(client.generateObject(Answer, MESSAGES)).rejects.toThrow(ProviderUnavailableError);
    expect(await client.health()).toMatchObject({ reachable: false });
  });

  it('reports a login error as unavailable and does not retry', async () => {
    process.env.FAKE_CLAUDE_MODE = 'auth';
    const client = createClaudeCodeClient({ effort: 'low', command: fake });
    await expect(client.generateObject(Answer, MESSAGES)).rejects.toThrow(/not logged in/);
    await expect(client.generateObject(Answer, MESSAGES)).rejects.toThrow(ProviderUnavailableError);
    expect(calls()).toHaveLength(2);
  });

  it('checks the command with --version and sends no model request', async () => {
    expect(await createClaudeCodeClient({ effort: 'low', command: fake }).health()).toMatchObject({ reachable: true, modelAvailable: true });
    expect(calls()).toHaveLength(0);
  });
});

describe('provider selection', () => {
  it('uses the local endpoint when the user selected no provider', () => {
    expect(getSetting('llm').provider).toBe('local');
    expect(createClient(getSetting('llm')).provider).toBe('local');
  });

  it('uses Claude Code with Haiku 5.5 after the user selects it with medium effort', async () => {
    // The health check of the selected provider must pass. The stub stands in for the installed command.
    const stub = stubLlm();
    const result = await saveLlmSettings({ ...getSetting('llm'), provider: 'claude-code', claudeEffort: 'medium' });
    expect(result.saved).toBe(true);
    expect(getSetting('llm')).toMatchObject({ provider: 'claude-code', claudeEffort: 'medium' });
    setLlmClientForTests(null);
    const client = createClient(getSetting('llm'));
    expect(client.provider).toBe('claude-code');
    expect(client.model).toBe('claude-haiku-5-5');
    expect(stub.calls).toEqual({ extract: 0, judge: 0, derive: 0, letter: 0, analysis: 0 });
  });

  it('keeps the earlier provider and reports the cause when the new provider does not respond', async () => {
    const stub = stubLlm();
    stub.healthResult = { reachable: false, modelAvailable: false, detail: 'the claude command is not available: spawn claude ENOENT' };
    const result = await saveLlmSettings({ ...getSetting('llm'), provider: 'claude-code' });
    expect(result.saved).toBe(false);
    expect(result.health.detail).toContain('not available');
    expect(getSetting('llm').provider).toBe('local');
  });
});

describe('availability', () => {
  it('pauses the language model lane when the provider is down and resumes it after a good probe', async () => {
    const events: AppEvent[] = [];
    const stop = subscribe((e) => {
      if (e.type === 'llm.status') events.push(e);
    });
    const stub = stubLlm();
    await probe();
    let down = true;
    stub.facts = () => {
      if (down) throw new ProviderUnavailableError('endpoint is down');
      return { city: 'Aarhus', score: 1 };
    };
    let done = 0;
    registerHandler('extract', async () => {
      await generateObject(Answer, MESSAGES, { name: 'posting_facts' });
      done++;
    });
    enqueue('extract', 'p1');
    enqueue('extract', 'p2');
    await whenIdle();
    expect(isLaneBlocked('llm')).toBe(true);
    expect(done).toBe(0);
    // The work waits. No attempt is counted against the retry limit.
    expect(tasksOf('extract').map((t) => [t.state, t.attempts])).toEqual([['pending', 0], ['pending', 0]]);
    expect(events.at(-1)).toEqual({ type: 'llm.status', available: false });

    // The endpoint responds again. The health probe resumes the queue without user action.
    down = false;
    await probe();
    await whenIdle();
    expect(isLaneBlocked('llm')).toBe(false);
    expect(done).toBe(2);
    expect(events.at(-1)).toEqual({ type: 'llm.status', available: true });
    stop();
  });
});
