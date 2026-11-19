import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

/** The path prefix the client is built for. The olympus-edge platform passes `/sieve/`; local builds use `/`. */
const base = process.env.APP_BASE ?? '/';

/**
 * Behind the olympus-edge portal the head links the portal's web app manifest and the home screen icon.
 * Local builds leave them out, because `/_auth/manifest/...` exists only on the portal.
 */
function edgeHead(): Plugin {
  const id = base.split('/').filter(Boolean).pop();
  return {
    name: 'sieve-edge-head',
    transformIndexHtml() {
      if (!id) return [];
      return [
        { tag: 'link', attrs: { rel: 'manifest', href: `/_auth/manifest/${id}.webmanifest`, crossorigin: 'use-credentials' }, injectTo: 'head' },
        { tag: 'link', attrs: { rel: 'apple-touch-icon', href: `${base}icon.png` }, injectTo: 'head' },
        { tag: 'meta', attrs: { name: 'apple-mobile-web-app-capable', content: 'yes' }, injectTo: 'head' },
        { tag: 'meta', attrs: { name: 'apple-mobile-web-app-title', content: 'sieve' }, injectTo: 'head' },
        { tag: 'meta', attrs: { name: 'apple-mobile-web-app-status-bar-style', content: 'black-translucent' }, injectTo: 'head' },
      ];
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
