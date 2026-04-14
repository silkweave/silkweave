import { defineConfig } from 'tsdown'

export default defineConfig({
  outDir: 'build',
  dts: true,
  entry: [
    'src/auth.ts',
    'src/cli.ts',
    'src/core.ts',
    'src/fastify.ts',
    'src/logger.ts',
    'src/mcp.ts',
    'src/typegen.ts',
    'src/vercel.ts'
  ]
})
