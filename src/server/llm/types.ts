import { z } from 'zod';

export interface Message {
  role: 'system' | 'user';
  content: string;
}

export interface GenerateOptions {
  /** Attempts for output that does not fit the schema. Default 3. */
  maxAttempts?: number;
  signal?: AbortSignal;
  /** Name of the schema for providers that need one. */
  name?: string;
}

export interface HealthResult {
  reachable: boolean;
  modelAvailable: boolean;
  detail?: string;
}

export interface LlmClient {
  readonly provider: 'local' | 'claude-code';
  readonly model: string;
  generateObject<T>(schema: z.ZodType<T>, messages: Message[], opts?: GenerateOptions): Promise<T>;
  health(): Promise<HealthResult>;
}

/** The provider did not answer, or it is not installed or not logged in. Work must wait. */
export class ProviderUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProviderUnavailableError';
  }
}

/** The provider answered, but the output did not fit the schema after all attempts. */
export class InvalidOutputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidOutputError';
  }
}

/**
 * JSON schema for a provider. The `$schema` key is removed, because the Claude Code command rejects
 * a schema that names a draft it cannot load, and no provider needs the key.
 */
export function providerJsonSchema(schema: z.ZodType): Record<string, unknown> {
  const { $schema: _draft, ...rest } = z.toJSONSchema(schema) as Record<string, unknown>;
  return rest;
}
