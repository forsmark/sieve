import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  root: 'src/client',
  plugins: [react(), tailwindcss()],
  build: { outDir: '../../dist/client', emptyOutDir: true },
  server: {
    // The dev server passes API calls on without a login, so it listens on this machine only by default.
    host: process.env.DEV_HOST ?? '127.0.0.1',
    port: 5173,
    proxy: { '/api': { target: 'http://127.0.0.1:3000', changeOrigin: false } },
  },
});
