import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

/**
 * The till must cold-load with no network at all (apps/till/CLAUDE.md, root CLAUDE.md
 * non-negotiable #5). Workbox precaches the entire app shell — JS, CSS, HTML, and the sqlite-wasm
 * binary the `@batch/storage` OPFS adapter needs — so a barista can open the till on a dead network
 * and take an order.
 */
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      includeAssets: ['icon.svg'],
      workbox: {
        // .wasm so the sqlite-wasm binary the OPFS LocalStore adapter loads is precached with the
        // rest of the shell — without it, a cold start on a dead network can't open the local store.
        // .woff2 so the self-hosted Spline Sans (design system font) cold-loads offline too; a
        // network font request on the order path is banned (apps/till/CLAUDE.md).
        globPatterns: ['**/*.{js,css,html,wasm,svg,woff2}'],
        // The sqlite-wasm binary is ~865 KB; lift the per-file precache cap so it is included.
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
      },
      manifest: {
        name: 'Batch Till',
        short_name: 'Batch',
        description: 'Batch — till for Irish coffee shops and small retail.',
        display: 'standalone',
        background_color: '#0b1f14',
        theme_color: '#0b1f14',
        icons: [
          {
            src: '/icon.svg',
            sizes: '192x192',
            type: 'image/svg+xml',
            purpose: 'any maskable',
          },
        ],
      },
    }),
  ],
  optimizeDeps: {
    // The wasm boundary must not be pre-bundled — see packages/storage/src/opfs.ts.
    exclude: ['@sqlite.org/sqlite-wasm'],
  },
  build: {
    target: 'es2022',
  },
})
