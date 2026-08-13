import { Action, ActionResource, SerializedResource, Silkweave } from '@silkweave/core'
import type {
  AnyTRPCRootTypes,
  TRPCBuiltRouter,
  TRPCMutationProcedure,
  TRPCQueryProcedure,
  TRPCSubscriptionProcedure
} from '@trpc/server'
import type { z } from 'zod/v4'

// Mirror the runtime key `camelCase(action.name)` from change-case: split on
// `.`/`-`/`_`/space separators, capitalize each following segment, and lowercase
// the leading character (so `list.users` -> `listUsers` and `Hello` -> `hello`,
// matching what buildRouter registers).
type CamelJoin<S extends string> = S extends `${infer A}${'.' | '-' | '_' | ' '}${infer B}`
  ? `${A}${Capitalize<CamelJoin<B>>}`
  : S
type CamelCase<S extends string> = Uncapitalize<CamelJoin<S>>

type ChunkOf<A extends Action> = A['run'] extends (...args: any[]) => AsyncGenerator<infer C, unknown, unknown>
  ? C
  : never

type IsStreaming<A extends Action> = A['run'] extends (...args: any[]) => AsyncGenerator<unknown, unknown, unknown>
  ? true
  : false

// A resource result crosses tRPC's JSON wire as its SerializedResource
// envelope (buildRouter serializes at runtime), so the inferred output type
// must say so too. Blob covers File (File extends Blob) without depending on
// the DOM/Node File global at the type level. The conditional distributes over
// unions, matching the per-call runtime detection.
type SerializeOutput<R> = R extends ActionResource | Blob | Uint8Array | ArrayBuffer ? SerializedResource : R

type ActionToProcedure<A extends Action> =
  IsStreaming<A> extends true
    ? TRPCSubscriptionProcedure<{
        meta: object
        input: z.infer<A['input']>
        output: ChunkOf<A>
      }>
    : 'query' extends NonNullable<A['kind']>
      ? TRPCQueryProcedure<{
          meta: object
          input: z.infer<A['input']>
          output: SerializeOutput<Awaited<ReturnType<A['run']>>>
        }>
      : TRPCMutationProcedure<{
          meta: object
          input: z.infer<A['input']>
          output: SerializeOutput<Awaited<ReturnType<A['run']>>>
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
export type InferTrpcRouter<S> =
  S extends Silkweave<infer Actions> ? TRPCBuiltRouter<TrpcRootTypes, ActionsToRouterRecord<Actions>> : never
