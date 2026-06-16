import { Action, Silkweave, SilkweaveOptions } from '@silkweave/core'
import type { InferTrpcRouter } from '@silkweave/trpc'
import { McpRouteHandlers, McpRouteOptions, TrpcRouteHandlers, TrpcRouteOptions } from '../types.js'
import { buildMcpRoute } from './mcpRoute.js'
import { buildTrpcRoute } from './trpcRoute.js'

/** Maps the actions tuple into the `Record<name, Action>` shape `Silkweave` carries. */
type ActionsRecord<Arr extends readonly Action[]> = {
  [K in Arr[number] as K['name']]: K
}

/** The typed `Silkweave` instance equivalent to `silkweave(...).actions(arr)`. */
type AppServer<Arr extends readonly Action[]> = Silkweave<ActionsRecord<Arr>>

/** Configuration for {@link defineSilkweave}: server identity + the action set. */
export type DefineSilkweaveOptions<Arr extends readonly Action[]> = SilkweaveOptions & {
  actions: Arr
}

/**
 * A Silkweave app projected onto Next.js App Router route handlers. Define it
 * once, then mount the surfaces you need from their respective route files.
 */
export interface SilkweaveApp<Arr extends readonly Action[]> {
  /** Build handlers for `app/<basePath>/[[...slug]]/route.ts` (MCP tools). */
  mcp(options: McpRouteOptions): McpRouteHandlers
  /** Build handlers for `app/<endpoint>/[trpc]/route.ts` (tRPC procedures). */
  trpc(options: TrpcRouteOptions): TrpcRouteHandlers
  /**
   * Type-only phantom for the tRPC client. Use as
   * `export type AppRouter = typeof app.Router`. Accessing the value at runtime
   * returns `undefined` - it exists purely to carry the inferred router type.
   */
  readonly Router: InferTrpcRouter<AppServer<Arr>>
}

/**
 * Define a Silkweave app from a single set of Actions and project it onto
 * Next.js App Router route handlers - MCP (for agents) and tRPC (for your
 * frontend) - from one source of truth.
 *
 * ```ts
 * // silkweave/server.ts
 * export const app = defineSilkweave({
 *   name: 'my-app', description: '...', version: '1.0.0',
 *   actions: [listUsers, getUser]
 * })
 * export type AppRouter = typeof app.Router
 * ```
 */
export function defineSilkweave<const Arr extends readonly Action[]>(
  options: DefineSilkweaveOptions<Arr>
): SilkweaveApp<Arr> {
  const { actions, ...identity } = options

  return {
    mcp: (mcpOptions) => buildMcpRoute(identity, actions, mcpOptions),
    trpc: (trpcOptions) => buildTrpcRoute(identity, actions, trpcOptions),
    Router: undefined as unknown as InferTrpcRouter<AppServer<Arr>>
  }
}
