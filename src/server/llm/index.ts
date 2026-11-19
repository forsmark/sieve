import type { z } from 'zod';
import { publish } from '../kernel/events';
import { log } from '../kernel/logger';
import { getSetting, setSetting, type SettingsMap } from '../kernel/settings';
import { LaneUnavailableError, setLaneBlocked } from '../kernel/tasks';
import { WRITING_EFFORT, WRITING_MODEL, createClaudeCodeClient } from './claude-code';
import { createOpenAiClient } from './openai';
import { ProviderUnavailableError, type GenerateOptions, type HealthResult, type LlmClient, type Message } from './types';

export * from './types';

type LlmSettings = SettingsMap['llm'];

let override: LlmClient | null = null;
let available: boolean | null = null;
let probeTimer: ReturnType<typeof setInterval> | null = null;

/** Tests replace the client with a stub. */
export function setLlmClientForTests(client: LlmClient | null): void {
  override = client;
}

export function createClient(settings: LlmSettings): LlmClient {
  if (settings.provider === 'claude-code') return createClaudeCodeClient({ effort: settings.claudeEffort });
  return createOpenAiClient({ baseUrl: settings.baseUrl, model: settings.model, apiKey: settings.apiKey });
}

export function getClient(): LlmClient {
  return override ?? createClient(getSetting('llm'));
}

export function isLlmAvailable(): boolean | null {
  return available;
}

function setAvailable(value: boolean): void {
  if (available === value) return;
  available = value;
  setLaneBlocked('llm', !value);
  publish({ type: 'llm.status', available: value });
  log(value ? 'info' : 'warn', value ? 'language model provider is available' : 'language model provider is not available');
}

/**
 * The one entry point for model calls from task handlers.
 * When the provider is down, the task returns to the queue and the language model lane pauses.
 */
export async function generateObject<T>(schema: z.ZodType<T>, messages: Message[], opts?: GenerateOptions): Promise<{ data: T; provider: string; model: string }> {
  const client = getClient();
  try {
    const data = await client.generateObject(schema, messages, opts);
    if (available !== true) setAvailable(true);
    return { data, provider: client.provider, model: client.model };
  } catch (err) {
    if (err instanceof ProviderUnavailableError) {
      setAvailable(false);
      throw new LaneUnavailableError(err.message);
    }
    throw err;
  }
}

export async function probe(): Promise<HealthResult> {
  const result = await getClient().health().catch((err) => ({ reachable: false, modelAvailable: false, detail: String(err) }));
  setAvailable(result.reachable);
  return result;
}

export function startHealthProbe(intervalMs = 30_000): void {
  if (probeTimer) return;
  void probe();
  probeTimer = setInterval(() => void probe(), intervalMs);
  probeTimer.unref?.();
}

export function stopHealthProbe(): void {
  if (probeTimer) clearInterval(probeTimer);
  probeTimer = null;
}

/**
 * Saves new provider settings after a health test.
 * A provider that does not respond is not saved, so the earlier provider stays in use.
 */
export async function saveLlmSettings(next: LlmSettings): Promise<{ saved: boolean; health: HealthResult }> {
  const current = getSetting('llm');
  const health = await (override ?? createClient(next)).health();
  // A change to another provider needs a provider that responds. An edit of the same provider is always saved.
  if (!health.reachable && next.provider !== current.provider) return { saved: false, health };
  setSetting('llm', next);
  setAvailable(health.reachable);
  return { saved: true, health };
}

// ---- Writing tasks

let writingOverride: LlmClient | null = null;

/** Tests replace the writing client with a stub. */
export function setWritingClientForTests(client: LlmClient | null): void {
  writingOverride = client;
}

/** The client for the CV digest and cover letters. It is always Claude Code with Fable 5.2, whatever the matching provider is. */
export function getWritingClient(): LlmClient {
  return writingOverride ?? createClaudeCodeClient({ model: WRITING_MODEL, effort: WRITING_EFFORT, timeoutMs: 300_000 });
}

/**
 * One model call for a writing task. A failure does not pause a lane.
 * The caller stores the error, and the user starts the task again.
 */
export async function generateWritingObject<T>(schema: z.ZodType<T>, messages: Message[], opts?: GenerateOptions): Promise<{ data: T; model: string }> {
  const client = getWritingClient();
  return { data: await client.generateObject(schema, messages, { maxAttempts: 2, ...opts }), model: client.model };
}
