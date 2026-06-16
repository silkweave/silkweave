import sitemap from '@astrojs/sitemap'
import vercel from "@astrojs/vercel"
import { defineConfig } from 'astro/config'

// Vite's default server conditions, inlined (vite isn't a direct dep here, so we
// can't import `defaultServerConditions`). Kept ahead of our custom source condition.
const serverConditions = ['module', 'node', 'development|production']

export default defineConfig({
  output: 'server',
  adapter: vercel({ maxDuration: 60 }),
  site: 'https://www.silkweave.dev',
  outDir: './build',
  publicDir: './static',
  build: {
    assets: '_assets',
    inlineStylesheets: 'always'
  },
  integrations: [
    sitemap()
  ],
  // Resolve workspace `@silkweave/*` server imports to TS source via our custom
  // export condition (kept off the published default so external consumers get build/).
  vite: {
    resolve: { conditions: ['@silkweave/source', ...serverConditions] },
    ssr: { resolve: { conditions: ['@silkweave/source', ...serverConditions] } }
  }
})
