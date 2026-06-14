import { type Action, type ActionKind, type HttpMethod, type SilkweaveContext } from '@silkweave/core'
import type z from 'zod/v4'

export const ACTION_METADATA = '__silkweave_action__'
export const ACTIONS_METADATA = '__silkweave_actions__'

export type Transport = 'rest' | 'trpc' | 'mcp'

export interface ActionMetadata<I extends object = object, O extends object = object, C = unknown> {
  /** Action name. Defaults to the kebab-cased method name. */
  name?: string
  /** Human-readable description. Becomes the MCP tool description and REST OpenAPI summary. */
  description: string
  /** Zod object schema for the action's input. */
  input: z.ZodType<I> & { shape: Record<string, z.ZodTypeAny> }
  /** Optional Zod object schema for the action's output (used by tRPC type inference). */
  output?: z.ZodType<O> & { shape: Record<string, z.ZodTypeAny> }
  /**
   * Zod schema for individual chunks yielded by a streaming (async-generator)
   * action method. Required when the decorated method is an `async function*`.
   * Mirrors `Action.chunk` in @silkweave/core; typegen/trpc use it to expose
   * the action as a tRPC subscription.
   */
  chunk?: z.ZodType<C>
  /** `'query'` (GET in REST, `.query()` in tRPC) or `'mutation'` (POST in REST, `.mutation()` in tRPC). Default: `'mutation'`. */
  kind?: ActionKind
  /** HTTP verb for the REST route. Defaults to `POST` (or `GET` when `kind` is `'query'`). Overrides the `kind`-derived default. */
  method?: HttpMethod
  /** REST route path, optionally with `:param` placeholders (e.g. `'spaces/:spaceId/users'`). Each placeholder must be a key of `input`. Defaults to the action name with dots as slashes. */
  path?: string
  /** Input fields read from the URL query string instead of the request body (e.g. `['offset', 'limit']`). Each must be a key of `input`. */
  queryParams?: (keyof I)[]
  /** Allowlist of transports that should expose this action. Default: all registered transports. */
  transports?: Transport[]
  /** Dynamic enable check (in addition to `transports`). AND-combined with the transports filter. */
  isEnabled?: (context: SilkweaveContext) => boolean
  /** Custom MCP `CallToolResult` formatter. See `@silkweave/mcp`'s `smartToolResult`. */
  toolResult?: Action<I, O>['toolResult']
  /** CLI positional-argument keys (unused for HTTP-only adapters, kept for parity with `createAction`). */
  args?: (keyof I)[]
  /** Custom MCP tool name override. If unset, derived from action name as PascalCase. */
  mcpToolName?: string
}

export interface ActionsClassMetadata {
  /** Prefix joined to the method-level action name with a dot. e.g. `Actions('users')` + method `list` → `users.list`. */
  prefix?: string
  /** Class-level transports allowlist. Method-level `transports` overrides; otherwise inherits this. */
  transports?: Transport[]
}

export interface ResultToolResult<O extends object = object> {
  toolResult?: Action<object, O>['toolResult']
}

export type AnyActionMetadata = ActionMetadata<object, object> & ResultToolResult<object>

export const ACTION_RESPONSE_KEY = '__silkweave_response__'
