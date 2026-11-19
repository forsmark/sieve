import { resolve } from 'node:path';

const isTest = process.env.NODE_ENV === 'test' || process.env.VITEST === 'true';

export const config = {
  isTest,
  isProduction: process.env.NODE_ENV === 'production',
  dataDir: resolve(process.env.DATA_DIR ?? './data'),
  /** Tests always use an in-memory database. They must never open the real file. */
  dbPath: isTest ? ':memory:' : resolve(process.env.DATA_DIR ?? './data', 'sieve.db'),
  port: Number(process.env.PORT ?? 3000),
  /** One optional password. Without it the server binds to the loopback address only. */
  authPassword: process.env.AUTH_PASSWORD || null,
  host: process.env.HOST ?? (process.env.AUTH_PASSWORD ? '0.0.0.0' : '127.0.0.1'),
};
