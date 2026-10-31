/// <reference types="vitest/config" />
import { createHash } from 'node:crypto';
import { readdirSync } from 'node:fs';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Emits a small service worker that precaches the production app shell and
 * every bundled asset, so a reload works without a network connection.
 * IndexedDB keeps the trips; this keeps the application itself available.
 */
function precacheServiceWorker(): Plugin {
  return {
    name: 'holiday-planner-precache-sw',
    apply: 'build',
    generateBundle(_options, bundle) {
      const publicFiles = readdirSync(new URL('./public', import.meta.url)).filter((f) => !f.startsWith('.'));
      const files = ['./', './index.html', ...publicFiles.map((f) => `./${f}`), ...Object.keys(bundle).map((f) => `./${f}`)];
      const unique = [...new Set(files)].filter((f) => f !== './sw.js' && !f.endsWith('.map')).sort();
      const version = createHash('sha256').update(unique.join('\n')).digest('hex').slice(0, 12);
      const source = `/* Generated at build time. Precaches the app shell for offline reloads. */
const CACHE = 'holiday-planner-${version}';
const PRECACHE = ${JSON.stringify(unique)};
self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(PRECACHE)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('holiday-planner-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});
self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;
  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).catch(() => caches.match('./index.html', { ignoreSearch: true, ignoreVary: true })));
    return;
  }
  // ignoreVary: Vite marks scripts and styles crossorigin, so requests carry an Origin header the precache requests did not.
  event.respondWith(caches.match(request, { ignoreSearch: true, ignoreVary: true }).then((hit) => hit || fetch(request)));
});
`;
      this.emitFile({ type: 'asset', fileName: 'sw.js', source });
    },
  };
}

export default defineConfig({
  plugins: [react(), precacheServiceWorker()],
  // The bundle includes the Temporal polyfill and the destination pack, so it is larger than a typical SPA.
  build: { target: 'es2022', sourcemap: true, chunkSizeWarningLimit: 900 },
  test: {
    environment: 'node',
    include: ['tests/{domain,planner,application,catalogue}/**/*.test.{ts,tsx}'],
    setupFiles: ['tests/helpers/setup.ts'],
  },
});
