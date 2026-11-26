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

export interface OpenAiClientConfig {
  baseUrl: string;
  model: string;
  apiKey?: string;
  timeoutMs?: number;
  fetch?: typeof fetch;
}

function parseJsonLoose(text: string): unknown {
  const trimmed = text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```$/, '')
    .trim();
  return JSON.parse(trimmed);
}

/**
 * Client for an OpenAI-compatible chat endpoint. Ollama, LM Studio, and llama.cpp serve this API.
 * It asks for JSON schema output. When the server rejects that, it falls back to JSON mode.
 * Every response is validated with the Zod schema. A failed validation causes a retry with the error text.
 */
export function createOpenAiClient(cfg: OpenAiClientConfig): LlmClient {
  const doFetch = cfg.fetch ?? fetch;
  const base = cfg.baseUrl.replace(/\/+$/, '').replace(/\/v1$/, '');
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (cfg.apiKey) headers.Authorization = `Bearer ${cfg.apiKey}`;
  let schemaModeRejected = false;

  async function post(body: unknown, signal?: AbortSignal): Promise<Response> {
    try {
      return await doFetch(`${base}/v1/chat/completions`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: AbortSignal.any([AbortSignal.timeout(cfg.timeoutMs ?? 180_000), ...(signal ? [signal] : [])]),
      });
    } catch (err) {
      throw new ProviderUnavailableError(`language model endpoint is unreachable: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async function complete(messages: Message[], jsonSchema: unknown, name: string, signal?: AbortSignal): Promise<string> {
    const common = { model: cfg.model, messages, temperature: 0.1, stream: false };
    let res: Response | null = null;
    if (!schemaModeRejected) {
      res = await post({ ...common, response_format: { type: 'json_schema', json_schema: { name, schema: jsonSchema, strict: true } } }, signal);
      if (res.status === 400 || res.status === 422) {
        schemaModeRejected = true;
        res = null;
      }
    }
    if (!res) {
      const withSchema: Message[] = [
        ...messages,
        { role: 'user', content: `Answer with one JSON object that fits this JSON schema. No other text.\n${JSON.stringify(jsonSchema)}` },
      ];
      res = await post({ ...common, messages: withSchema, response_format: { type: 'json_object' } }, signal);
    }
    if (res.status >= 500 || res.status === 404 || res.status === 401 || res.status === 403) {
      throw new ProviderUnavailableError(`language model endpoint returned HTTP ${res.status}`);
    }
    if (!res.ok) throw new InvalidOutputError(`language model endpoint returned HTTP ${res.status}`);
    const json = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    return json.choices?.[0]?.message?.content ?? '';
  }

  return {
    provider: 'local',
    model: cfg.model,

    async generateObject<T>(schema: z.ZodType<T>, messages: Message[], opts: GenerateOptions = {}): Promise<T> {
      const jsonSchema = providerJsonSchema(schema);
      const maxAttempts = opts.maxAttempts ?? 3;
      let conversation = messages;
      let lastError = '';
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        const text = await complete(conversation, jsonSchema, opts.name ?? 'result', opts.signal);
        try {
          const parsed = schema.safeParse(parseJsonLoose(text));
          if (parsed.success) return parsed.data;
          lastError = z.prettifyError(parsed.error);
        } catch (err) {
          lastError = `not valid JSON: ${err instanceof Error ? err.message : String(err)}`;
        }
        conversation = [
          ...messages,
          { role: 'user', content: `Your last answer was rejected: ${lastError}\nAnswer again with one JSON object that fits the schema.` },
        ];
      }
      throw new InvalidOutputError(`model output did not fit the schema after ${maxAttempts} attempts: ${lastError}`);
    },

    async health(): Promise<HealthResult> {
      try {
        const res = await doFetch(`${base}/v1/models`, { headers, signal: AbortSignal.timeout(5000) });
        if (!res.ok) return { reachable: false, modelAvailable: false, detail: `HTTP ${res.status}` };
        const json = (await res.json()) as { data?: Array<{ id?: string }> };
        const ids = (json.data ?? []).map((m) => m.id ?? '');
        const modelAvailable = ids.some((id) => id === cfg.model || id.startsWith(`${cfg.model}:`) || cfg.model.startsWith(`${id}:`));
        return { reachable: true, modelAvailable, detail: modelAvailable ? undefined : `model "${cfg.model}" is not in the model list` };
      } catch (err) {
        return { reachable: false, modelAvailable: false, detail: err instanceof Error ? err.message : String(err) };
      }
    },
  };
}
