import { defineConfig } from 'tsdown'

export default defineConfig({
  outDir: 'build',
  dts: true,
  entry: ['src/index.ts']
})
