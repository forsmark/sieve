import { spawn } from 'node:child_process';
import { z } from 'zod';
import {
  InvalidOutputError,
  ProviderUnavailableError,
  providerJsonSchema,
  type GenerateOptions,
  type HealthResult,
  type LlmClient,
  type Message,
} from './types';

/** The Claude Code provider uses this model for posting extraction and judging. Only the effort level is a setting. */
export const CLAUDE_CODE_MODEL = 'claude-haiku-5-5';

/** Writing tasks, which are the CV digest and cover letters, always use this model at this effort. */
export const WRITING_MODEL = 'claude-fable-5-2';
export const WRITING_EFFORT = 'medium';

export interface ClaudeCodeConfig {
  effort: 'low' | 'medium';
  /** Default: the matching model. */
  model?: string;
  /** Path or name of the executable. Tests pass a fake one. */
  command?: string;
  timeoutMs?: number;
}

interface ProcessResult {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  spawnError: string | null;
}

function run(command: string, args: string[], input: string, timeoutMs: number, signal?: AbortSignal): Promise<ProcessResult> {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let settled = false;
    const finish = (r: ProcessResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(r);
    };
    const child = spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);
    signal?.addEventListener('abort', () => child.kill('SIGKILL'), { once: true });
    child.on('error', (err) => finish({ code: null, stdout, stderr, timedOut, spawnError: err.message }));
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('close', (code) => finish({ code, stdout, stderr, timedOut, spawnError: null }));
    child.stdin.on('error', () => {});
    // The prompt goes to standard input, so posting text never shows in the process list.
    child.stdin.end(input);
  });
}

const AUTH_PATTERN = /not logged in|log ?in|authenticat|unauthori[sz]ed|invalid api key|credential|\/login|401|403/i;

/**
 * Client that starts the locally installed Claude Code command once for each call.
 * The command gets no tools, so the model can only answer. `--json-schema` gives structured output.
 */
export function createClaudeCodeClient(cfg: ClaudeCodeConfig): LlmClient {
  const command = cfg.command ?? 'claude';
  const model = cfg.model ?? CLAUDE_CODE_MODEL;

  function args(systemPrompt: string, jsonSchema: unknown): string[] {
    return [
      '-p',
      '--model',
      model,
      '--effort',
      cfg.effort,
      '--output-format',
      'json',
      '--json-schema',
      JSON.stringify(jsonSchema),
      '--tools',
      '',
      '--no-session-persistence',
      '--system-prompt',
      systemPrompt,
    ];
  }

  async function call(systemPrompt: string, prompt: string, jsonSchema: unknown, signal?: AbortSignal): Promise<unknown> {
    const r = await run(command, args(systemPrompt, jsonSchema), prompt, cfg.timeoutMs ?? 120_000, signal);
    if (r.spawnError) throw new ProviderUnavailableError(`the claude command is not available: ${r.spawnError}`);
    if (r.timedOut) throw new InvalidOutputError('the claude command timed out and was stopped');
    let parsed: any = null;
    try {
      parsed = JSON.parse(r.stdout);
    } catch {
      // Handled below.
    }
    const errorText = `${parsed?.result ?? ''} ${r.stderr}`.trim();
    if (r.code !== 0 || parsed?.is_error) {
      if (AUTH_PATTERN.test(errorText) || parsed?.api_error_status === 401 || parsed?.api_error_status === 403) {
        throw new ProviderUnavailableError(`the claude command is not logged in: ${errorText.slice(0, 200)}`);
      }
      if (typeof parsed?.api_error_status === 'number' && parsed.api_error_status >= 429) {
        throw new ProviderUnavailableError(`the Claude service is not available (HTTP ${parsed.api_error_status})`);
      }
      throw new InvalidOutputError(`the claude command failed (exit ${r.code}): ${errorText.slice(0, 300)}`);
    }
    if (parsed?.structured_output !== undefined && parsed.structured_output !== null) return parsed.structured_output;
    if (typeof parsed?.result === 'string') return JSON.parse(parsed.result);
    throw new InvalidOutputError('the claude command returned no structured output');
  }

  return {
    provider: 'claude-code',
    model,

    async generateObject<T>(schema: z.ZodType<T>, messages: Message[], opts: GenerateOptions = {}): Promise<T> {
      const jsonSchema = providerJsonSchema(schema);
      const system =
        messages
          .filter((m) => m.role === 'system')
          .map((m) => m.content)
          .join('\n\n') || 'Answer only with the structured output.';
      const user = messages
        .filter((m) => m.role === 'user')
        .map((m) => m.content)
        .join('\n\n');
      const maxAttempts = opts.maxAttempts ?? 3;
      let prompt = user;
      let lastError = '';
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
          const parsed = schema.safeParse(await call(system, prompt, jsonSchema, opts.signal));
          if (parsed.success) return parsed.data;
          lastError = z.prettifyError(parsed.error);
        } catch (err) {
          if (err instanceof ProviderUnavailableError) throw err;
          lastError = err instanceof Error ? err.message : String(err);
        }
        prompt = `${user}\n\nYour last answer was rejected: ${lastError}\nAnswer again and fit the schema.`;
      }
      throw new InvalidOutputError(`model output did not fit the schema after ${maxAttempts} attempts: ${lastError}`);
    },

    /** Runs `claude --version`. It sends no model request, so it has no cost. */
    async health(): Promise<HealthResult> {
      const r = await run(command, ['--version'], '', 10_000);
      if (r.spawnError) return { reachable: false, modelAvailable: false, detail: `the claude command is not available: ${r.spawnError}` };
      if (r.code !== 0) return { reachable: false, modelAvailable: false, detail: `claude --version exited with ${r.code}` };
      return { reachable: true, modelAvailable: true, detail: r.stdout.trim() };
    },
  };
}
