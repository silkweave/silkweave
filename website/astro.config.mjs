import { defineConfig } from 'astro/config'

export default defineConfig({
  outDir: './build',
  publicDir: './static',
  build: {
    assets: '_assets',
    inlineStylesheets: 'always'
  }
})
