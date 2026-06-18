import { defineConfig } from 'tsdown'

export default defineConfig({
  outDir: 'build',
  dts: true,
  // One entry per public export. The shared reflection core is code-split into a
  // chunk, so importing a subpath (e.g. ./trpc) never loads another adapter's
  // stack (the MCP SDK, @trpc/server, ...).
  entry: ['src/index.ts', 'src/mcp.ts', 'src/trpc.ts', 'src/typegen.ts']
})
