import sitemap from '@astrojs/sitemap'
import vercel from "@astrojs/vercel"
import { defineConfig } from 'astro/config'

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
  ]
})
