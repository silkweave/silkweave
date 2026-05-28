import { AdapterFactory } from '@silkweave/core'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { generateDts } from '../lib/generateDts.js'
import { generateTrpcRouter } from '../lib/generateTrpcRouter.js'

export type TypegenFormat = 'interfaces' | 'trpc-router' | 'all'

export interface TypegenAdapterOptions {
  /** Output file path for the generated `.d.ts` file. Resolved against `process.cwd()`. Parent directories are created automatically. */
  path: string
  /**
   * What to emit:
   * - `'interfaces'` - `{Name}Input` / `{Name}Output` interfaces per action (REST/MCP consumers)
   * - `'trpc-router'` - `AppRouter` type alias for `createTRPCClient<AppRouter>()`
   * - `'all'` (default) - both
   */
  format?: TypegenFormat
}

export function renderTypegen(actions: Parameters<typeof generateDts>[0], format: TypegenFormat = 'all'): string {
  // `generateTrpcRouter` emits a top-level `import` line, so it must come
  // first when both blocks are produced.
  const blocks: string[] = []
  if (format === 'trpc-router' || format === 'all') { blocks.push(generateTrpcRouter(actions)) }
  if (format === 'interfaces' || format === 'all') { blocks.push(generateDts(actions)) }
  return blocks.join('\n')
}

export const typegen: AdapterFactory<TypegenAdapterOptions> = ({ path, format = 'all' }) => {
  return (_, context) => {
    context.set('adapter', 'typegen')
    return {
      context,
      allActions: true,
      start: async (actions) => {
        const output = renderTypegen(actions, format)
        const target = resolve(path)
        await mkdir(dirname(target), { recursive: true })
        await writeFile(target, output, 'utf-8')
        console.info(`typegen: wrote ${actions.length} action types to ${target}`)
      },
      stop: async () => { /* noop */ }
    }
  }
}
