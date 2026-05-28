import { renderTypegen, type TypegenFormat } from '@silkweave/typegen'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import type { NestAdapterRegisterContext, NestSilkweaveAdapter } from '../lib/types.js'

export interface TypegenAdapterOptions {
  /** Output file path for the generated `.d.ts` file. Resolved against `process.cwd()`. Parent directories are created automatically. */
  path: string
  /**
   * What to emit (default `'all'`):
   * - `'interfaces'` - `{Name}Input` / `{Name}Output` interfaces per action
   * - `'trpc-router'` - `AppRouter` type alias for `createTRPCClient<AppRouter>()`
   * - `'all'` - both
   */
  format?: TypegenFormat
  /**
   * Whether to write the file at all. Default: `process.env.NODE_ENV !== 'production'`.
   * Server processes generally shouldn't write to disk in production deploys -
   * leave it on the default unless you know you want otherwise.
   */
  enabled?: boolean
}

/**
 * Typegen adapter for `@silkweave/nestjs`. Discovers every `@Action`-decorated
 * method (regardless of `transports` filtering) and writes a single `.d.ts`
 * file with REST input/output interfaces and/or a tRPC `AppRouter` type alias.
 *
 * Designed for the monorepo pattern where the server (this app) is the source
 * of truth for types and consumer apps import from `path` - e.g.
 * `path: '../app/src/types/silkweave.ts'`.
 */
export function typegen(options: TypegenAdapterOptions): NestSilkweaveAdapter {
  const enabled = options.enabled ?? (process.env['NODE_ENV'] !== 'production')
  return {
    name: 'typegen',
    allActions: true,
    register({ actions }: NestAdapterRegisterContext): void {
      if (!enabled) { return }
      const output = renderTypegen(actions, options.format ?? 'all')
      const target = resolve(options.path)
      // Fire-and-forget: we don't want to make `configure()` await disk IO and
      // delay app startup. Errors are surfaced via console.
      void (async () => {
        try {
          await mkdir(dirname(target), { recursive: true })
          await writeFile(target, output, 'utf-8')
          console.info(`@silkweave/nestjs typegen: wrote ${actions.length} action types to ${target}`)
        } catch (err) {
          console.error('@silkweave/nestjs typegen:', err)
        }
      })()
    }
  }
}
