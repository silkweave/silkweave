import { defineConfig } from 'astro/config'

export default defineConfig({
  outDir: './dist',
  publicDir: './static',
  build: {
    assets: '_assets',
    inlineStylesheets: 'always'
  }
})
