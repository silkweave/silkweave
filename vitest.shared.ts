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
// Only the custom source condition + `node`. Never list `import`/`module`
// here: the list is applied to the test worker's own resolution, where a
// blanket `import` condition poisons CJS require() chains (e.g. express ->
// router -> is-promise resolving to its ESM build under require) - Node and
// Vite already apply import/require contextually per call site.
const conditions = ['@silkweave/source', 'node']

export const sharedConfig = defineConfig({
  resolve: { conditions },
  // Vitest resolves test files through Vite's SSR environment, which has its
  // own condition list - without an explicit ssr entry, cross-package
  // `@silkweave/*` imports resolve via the default node conditions to each
  // package's `build/` output, so a test using a NEW cross-package symbol
  // would see `undefined` until a rebuild.
  ssr: { resolve: { conditions } },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    server: {
      deps: {
        // Cross-package @silkweave/* imports go through Vite's resolver (where
        // the source condition applies); everything under node_modules stays
        // externalized to native Node resolution - letting Vite process a CJS
        // package like express breaks its internal require() chains (e.g.
        // router -> is-promise resolving to the ESM build under require).
        inline: [
          '@silkweave/core', '@silkweave/auth', '@silkweave/mcp', '@silkweave/cli',
          '@silkweave/fastify', '@silkweave/trpc', '@silkweave/edge',
          '@silkweave/nextjs', '@silkweave/nestjs', '@silkweave/typegen', '@silkweave/ai'
        ],
        external: [/node_modules/]
      }
    }
  }
})
