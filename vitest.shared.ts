import { defineConfig } from 'vitest/config'

/**
 * Shared Vitest base, re-exported by each package's `vitest.config.ts`.
 *
 * The custom `@silkweave/source` condition makes cross-package `@silkweave/*`
 * imports resolve to TS source (no build step needed), exactly as the example
 * Vite/Astro configs do. The trailing entries are the standard ESM resolution
 * conditions Vite would otherwise apply (setting `resolve.conditions` replaces
 * the default list rather than prepending, so we restate them).
 */
export const sharedConfig = defineConfig({
  resolve: {
    conditions: ['@silkweave/source', 'import', 'module', 'node', 'default']
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'test/**/*.test.ts']
  }
})
