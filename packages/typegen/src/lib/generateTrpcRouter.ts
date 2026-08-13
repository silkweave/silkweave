import { type Action, isBinarySchema, isStreamingAction } from '@silkweave/core'
import { camelCase } from 'change-case'
import { serializedResourceType, zodToTs } from './zodToTs.js'

const TRPC_PROCEDURE_TYPES = [
  'AnyTRPCRootTypes',
  'TRPCBuiltRouter',
  'TRPCMutationProcedure',
  'TRPCQueryProcedure',
  'TRPCSubscriptionProcedure'
] as const

/**
 * Emit an `AppRouter` type alias compatible with `createTRPCClient<AppRouter>()`.
 *
 * The router mirrors what `@silkweave/trpc`'s `buildRouter()` builds at runtime
 * and what `InferTrpcRouter<S>` infers at the type level: each action name
 * collapses to camelCase, queries become `TRPCQueryProcedure`, mutations
 * `TRPCMutationProcedure`, with the action's input/output types embedded.
 */
export function generateTrpcRouter(actions: Action[]): string {
  const importDecl = `import type { ${TRPC_PROCEDURE_TYPES.join(', ')} } from '@trpc/server'`

  const rootTypeAlias = `type TrpcRootTypes = {
  ctx: object
  meta: object
  errorShape: unknown
  transformer: false
} & AnyTRPCRootTypes`

  const procedures = actions.map((action) => {
    const streaming = isStreamingAction(action)
    const procedureType = streaming
      ? 'TRPCSubscriptionProcedure'
      : action.kind === 'query'
        ? 'TRPCQueryProcedure'
        : 'TRPCMutationProcedure'
    // Nested two levels deep inside `TRPCBuiltRouter<_, { key: Type<{ ... }> }>`.
    const outputType = streaming
      ? action.chunk
        ? zodToTs(action.chunk, 2)
        : 'unknown'
      : isBinarySchema(action.output)
        ? // A binary() output crosses tRPC's JSON wire as SerializedResource.
          serializedResourceType(2)
        : action.output
          ? zodToTs(action.output, 2)
          : 'unknown'
    return `  ${camelCase(action.name)}: ${procedureType}<{
    meta: object
    input: ${zodToTs(action.input, 2)}
    output: ${outputType}
  }>`
  })

  const routerAlias = `export type AppRouter = TRPCBuiltRouter<TrpcRootTypes, {
${procedures.join('\n')}
}>`

  return [importDecl, rootTypeAlias, routerAlias].join('\n\n') + '\n'
}
