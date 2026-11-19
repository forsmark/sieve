import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'sqlite',
  schema: './src/server/kernel/schema.ts',
  out: './drizzle',
});
