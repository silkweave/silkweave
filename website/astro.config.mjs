import sitemap from '@astrojs/sitemap'
import vercel from "@astrojs/vercel"
import { defineConfig } from 'astro/config'

// Vite's default server conditions, inlined (vite isn't a direct dep here, so we
// can't import `defaultServerConditions`). Kept ahead of our custom source condition.
const serverConditions = ['module', 'node', 'development|production']

export default defineConfig({
  output: 'server',
  adapter: vercel({ maxDuration: 60, imageService: true }),
  site: 'https://www.silkweave.dev',
  // Canonicals are no-slash; enforce the same everywhere so /path/ 308-redirects to
  // /path (kills the trailing-slash duplicate pages) and the sitemap drops the slash
  // to match the canonical (fixes non-canonical-in-sitemap + indexable-not-in-sitemap).
  trailingSlash: 'never',
  outDir: './build',
  publicDir: './static',
  build: {
    format: 'file',
    assets: '_assets',
    inlineStylesheets: 'always'
  },
  integrations: [
    // /test is a live tRPC demo with no inbound links - keep it out of the sitemap
    // (it is also noindex'd at the page level).
    sitemap({ filter: (page) => page !== 'https://www.silkweave.dev/test' })
  ],
  // Resolve workspace `@silkweave/*` server imports to TS source via our custom
  // export condition (kept off the published default so external consumers get build/).
  vite: {
    resolve: { conditions: ['@silkweave/source', ...serverConditions] },
    ssr: { resolve: { conditions: ['@silkweave/source', ...serverConditions] } }
  }
})
