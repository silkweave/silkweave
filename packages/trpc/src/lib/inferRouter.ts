import { Action, Silkweave } from '@silkweave/core'
import type {
  AnyTRPCRootTypes,
  TRPCBuiltRouter,
  TRPCMutationProcedure,
  TRPCQueryProcedure
} from '@trpc/server'
import type { z } from 'zod'

type CamelCase<S extends string> = S extends `${infer A}-${infer B}`
  ? `${A}${Capitalize<CamelCase<B>>}`
  : S extends `${infer A}_${infer B}`
    ? `${A}${Capitalize<CamelCase<B>>}`
    : S

type ActionToProcedure<A extends Action> = 'query' extends NonNullable<A['kind']>
  ? TRPCQueryProcedure<{
    meta: object
    input: z.infer<A['input']>
    output: Awaited<ReturnType<A['run']>>
  }>
  : TRPCMutationProcedure<{
    meta: object
    input: z.infer<A['input']>
    output: Awaited<ReturnType<A['run']>>
  }>

type ActionsToRouterRecord<Actions extends Record<string, Action>> = {
  [K in keyof Actions & string as CamelCase<Actions[K]['name']>]: ActionToProcedure<Actions[K]>
}

type TrpcRootTypes = {
  ctx: object
  meta: object
  errorShape: unknown
  transformer: false
} & AnyTRPCRootTypes

/**
 * Extracts a fully-typed tRPC router from a Silkweave builder instance.
 *
 * Usage:
 * ```ts
 * const server = silkweave(opts).adapter(trpc({ port: 8080 })).action(HelloAction)
 * export type AppRouter = InferTrpcRouter<typeof server>
 * ```
 */
export type InferTrpcRouter<S> = S extends Silkweave<infer Actions>
  ? TRPCBuiltRouter<TrpcRootTypes, ActionsToRouterRecord<Actions>>
  : never
