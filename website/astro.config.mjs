import { defineConfig } from 'astro/config'
import sitemap from '@astrojs/sitemap'

export default defineConfig({
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
