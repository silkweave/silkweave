import { defineConfig } from 'tsup'

export default defineConfig({
  entry: [
    'src/auth.ts',
    'src/cli.ts',
    'src/core.ts',
    'src/fastify.ts',
    'src/logger.ts',
    'src/mcp.ts',
    'src/vercel.ts'
  ],
  outDir: 'build',
  format: ['esm'],
  target: 'es2022',
  dts: true,
  clean: true,
  sourcemap: true,
  splitting: false,
  external: [/^[^./]/]
})
