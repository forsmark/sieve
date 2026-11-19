import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: 'server',
          environment: 'node',
          include: ['src/server/**/*.test.ts', 'src/shared/**/*.test.ts'],
          env: { NODE_ENV: 'test' },
        },
      },
      {
        extends: true,
        test: {
          name: 'client',
          environment: 'jsdom',
          include: ['src/client/**/*.test.{ts,tsx}'],
          setupFiles: ['src/client/src/test-setup.ts'],
        },
      },
    ],
  },
});
