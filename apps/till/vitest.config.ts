import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    passWithNoTests: true,
    // Node environment for the sync-core tests. Component tests opt into jsdom per-file with
    // `// @vitest-environment jsdom`.
    environment: 'node',
  },
})
