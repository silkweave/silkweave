import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import type { TypegenFormat } from '@silkweave/typegen'
import type { NestAdapterRegisterContext, NestSilkweaveAdapter } from '../lib/types.js'

export interface TypegenAdapterOptions {
  /** Output file path for the generated `.d.ts`/`.ts` file. Resolved against `process.cwd()`. Parent dirs are created. */
  path: string
  /**
   * What to emit. Defaults to `'trpc-router'` - an `AppRouter` type alias
   * (`TRPCBuiltRouter`) for `createTRPCClient<AppRouter>()`, with one
   * `TRPCQueryProcedure`/`TRPCMutationProcedure`/`TRPCSubscriptionProcedure` per
   * `@Trpc` route keyed by camelCase name, carrying precise input/output types.
   * Use `'interfaces'` for `{Name}Input`/`{Name}Output` interfaces, or `'all'` for both.
   */
  format?: TypegenFormat
}

/**
 * Type-generation adapter for `@silkweave/nestjs`. On module bootstrap it writes
 * a `.ts` file containing the tRPC `AppRouter` type covering every `@Trpc`
 * procedure - the exact `TRPCBuiltRouter` contract `createTRPCClient<AppRouter>()`
 * + `inferRouterInputs`/`inferRouterOutputs` consume. It only sees `@Trpc`
 * actions (MCP tools are gated out), so the emitted router matches what the
 * `trpc()` adapter serves at runtime.
 *
 * `@silkweave/typegen` (which pulls in the TypeScript compiler API) is imported
 * lazily inside `register()`, so MCP-only apps that never use this adapter don't
 * load it.
 */
export function typegen(options: TypegenAdapterOptions): NestSilkweaveAdapter {
  return {
    name: 'typegen',
    register({ actions }: NestAdapterRegisterContext): void {
      const target = resolve(options.path)
      void (async () => {
        const { renderTypegen } = await import('@silkweave/typegen')
        const output = renderTypegen(actions, options.format ?? 'trpc-router')
        await mkdir(dirname(target), { recursive: true })
        await writeFile(target, output, 'utf-8')
        console.info(`@silkweave/nestjs typegen: wrote ${actions.length} tRPC procedure types to ${target}`)
      })().catch((error: unknown) => {
        console.error(`@silkweave/nestjs typegen: failed to write ${target}:`, error)
      })
    }
  }
}
