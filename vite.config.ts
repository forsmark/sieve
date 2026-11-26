import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

/** The path prefix the client is built for. The olympus-edge platform passes `/sieve/`; local builds use `/`. */
const base = process.env.APP_BASE ?? '/';

/**
 * Behind the olympus-edge portal the head links the portal's web app manifest. Local builds leave it out,
 * because `/_auth/manifest/...` exists only on the portal. The home screen icon and the web-app meta tags
 * stand in index.html for every build.
 */
function edgeHead(): Plugin {
  const id = base.split('/').filter(Boolean).pop();
  return {
    name: 'sieve-edge-head',
    transformIndexHtml() {
      if (!id) return [];
      return [{ tag: 'link', attrs: { rel: 'manifest', href: `/_auth/manifest/${id}.webmanifest`, crossorigin: 'use-credentials' }, injectTo: 'head' }];
    },
  };
}

export default defineConfig({
  root: 'src/client',
  base,
  plugins: [react(), tailwindcss(), edgeHead()],
  build: { outDir: '../../dist/client', emptyOutDir: true },
  server: {
    // The dev server passes API calls on without a login, so it listens on this machine only by default.
    host: process.env.DEV_HOST ?? '127.0.0.1',
    port: 5173,
    proxy: { '/api': { target: 'http://127.0.0.1:3000', changeOrigin: false } },
  },
});
