import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig, type ServerOptions } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

/**
 * The till must cold-load with no network at all (apps/till/CLAUDE.md, root CLAUDE.md
 * non-negotiable #5). Workbox precaches the entire app shell — JS, CSS, HTML, and the sqlite-wasm
 * binary the `@batch/storage` OPFS adapter needs — so a barista can open the till on a dead network
 * and take an order.
 *
 * ## HTTPS dev server (for on-device testing on a physical iPad)
 * Safari registers a service worker and grants OPFS / `navigator.storage.persist()` only in a
 * **secure context**. `http://<lan-ip>:5173` is NOT secure, so the SW never registers and "Add to
 * Home Screen" produces a dead shortcut. We therefore serve dev over HTTPS with an mkcert-signed
 * cert (see `certs/README.md`). The cert files are git-ignored and machine-local; if they are
 * absent we fall back to plain HTTP with a warning so `vite build` and a laptop-only `vite dev`
 * still work — only the on-device durability testing needs the certs.
 */

const certDir = fileURLToPath(new URL('./certs', import.meta.url))
const keyPath = `${certDir}/dev-key.pem`
const certPath = `${certDir}/dev.pem`

function devHttps(): ServerOptions['https'] {
  if (existsSync(keyPath) && existsSync(certPath)) {
    return { key: readFileSync(keyPath), cert: readFileSync(certPath) }
  }
  console.warn(
    '[vite] no dev cert at apps/till/certs/dev.pem — serving HTTP. iPad SW/OPFS/persist testing ' +
      'needs HTTPS; run mkcert per apps/till/certs/README.md.',
  )
  return undefined
}

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      // 'prompt', not 'autoUpdate': autoUpdate ships `skipWaiting` + `clientsClaim`, so deploying a
      // new build can reload the page out from under a barista mid-order. 'prompt' leaves the new SW
      // waiting until the app explicitly chooses to activate it (between orders), never mid-sale.
      registerType: 'prompt',
      injectRegister: 'auto',
      includeAssets: ['icon.svg', 'apple-touch-icon.png'],
      // Enable the service worker in dev too — the whole point of the HTTPS dev server is to verify
      // SW registration + offline behaviour on the real iPad, which needs the SW actually running.
      devOptions: {
        enabled: true,
        navigateFallback: 'index.html',
        suppressWarnings: true,
      },
      workbox: {
        // .wasm so the sqlite-wasm binary the OPFS LocalStore adapter loads is precached with the
        // rest of the shell — without it, a cold start on a dead network can't open the local store.
        // .woff2 so the self-hosted Spline Sans (design system font) cold-loads offline too; a
        // network font request on the order path is banned (apps/till/CLAUDE.md). .png so the
        // apple-touch-icon / maskable icon are cached with the shell.
        globPatterns: ['**/*.{js,css,html,wasm,svg,woff2,png}'],
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
          {
            // Raster fallback — iOS ignores SVG manifest icons; a real PNG is needed for the
            // home-screen icon. 180×180 is the apple-touch-icon size, reused here.
            src: '/apple-touch-icon.png',
            sizes: '180x180',
            type: 'image/png',
            purpose: 'any',
          },
        ],
      },
    }),
  ],
  server: {
    // Bind 0.0.0.0 so the dev server is reachable from the iPad over the LAN, not just localhost.
    host: true,
    https: devHttps(),
  },
  optimizeDeps: {
    // The wasm boundary must not be pre-bundled — see packages/storage/src/opfs.ts.
    exclude: ['@sqlite.org/sqlite-wasm'],
  },
  build: {
    target: 'es2022',
  },
})
