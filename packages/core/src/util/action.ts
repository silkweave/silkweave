import z from 'zod/v4'
import { SilkweaveContext } from './context.js'
import { SilkweaveError } from './error.js'
import { isBinarySchema } from './resource.js'

/**
 * The shape an action's `toolResult` hook returns - a structural, dependency-free
 * mirror of the MCP SDK's `CallToolResult`. Kept in core (rather than importing
 * `@modelcontextprotocol/sdk`) so a CLI/Fastify/tRPC-only install never pulls the
 * entire MCP HTTP server stack for a single type. An SDK `CallToolResult` is
 * assignable to this; the MCP adapters narrow it back at the SDK boundary.
 */
export interface ToolResult {
  content: Array<{ type: string } & Record<string, unknown>>
  structuredContent?: Record<string, unknown>
  isError?: boolean
  _meta?: Record<string, unknown>
  [key: string]: unknown
}

export type ActionKind = 'query' | 'mutation'

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE'

/**
 * MCP tool annotations (spec `ToolAnnotations`) - client-facing hints about a
 * tool's behavior, used by MCP hosts to group and permission-gate tools. All
 * hints are advisory. Structurally compatible with the MCP SDK's
 * `ToolAnnotations`, defined here so non-MCP packages can set them without a
 * type dependency on the SDK.
 */
export interface ToolAnnotations {
  /** Human-readable title override for the tool. */
  title?: string
  /** The tool does not modify its environment. */
  readOnlyHint?: boolean
  /** The tool may perform destructive updates (only meaningful when not read-only). */
  destructiveHint?: boolean
  /** Repeated calls with the same arguments have no additional effect. */
  idempotentHint?: boolean
  /** The tool may interact with an open world of external entities. */
  openWorldHint?: boolean
}

export type ActionRun<I, O> = (input: I, context: SilkweaveContext) => Promise<O>
export type ActionStreamRun<I, C> = (input: I, context: SilkweaveContext) => AsyncGenerator<C, void, void>

export interface Action<
  I extends object = any,
  O extends object = any,
  N extends string = string,
  K extends ActionKind = ActionKind,
  C = any
> {
  name: N
  description: string
  input: z.ZodType<I> & { shape: Record<string, z.ZodTypeAny> }
  output?: z.ZodType<O> & { shape: Record<string, z.ZodTypeAny> }
  /**
   * Schema for individual chunks yielded by a streaming `run`. Required when
   * `run` is an async generator; adapters detect streaming actions by checking
   * `isStreamingAction(action)` at runtime, but type-aware tooling (inferRouter,
   * typegen) uses the presence of this field.
   */
  chunk?: z.ZodType<C>
  kind?: K
  /**
   * HTTP verb for REST-style adapters (fastify, nestjs `rest`). Defaults to
   * `POST`, or `GET` when `kind` is `'query'`. An explicit `method` always wins.
   */
  method?: HttpMethod
  /**
   * Route path for REST-style adapters. May contain `:param` placeholders
   * (e.g. `'spaces/:spaceId/users'`); each placeholder must be a key of the
   * input schema and is resolved from the URL path at runtime. When unset, the
   * adapter derives the path from `name`.
   */
  path?: string
  /**
   * Input fields sourced from the URL query string instead of the request body
   * (e.g. `['offset', 'limit']`). Each must be a key of the input schema; their
   * required/optional status is validated by the input schema as usual.
   */
  queryParams?: (keyof I)[]
  args?: (keyof I)[]
  /**
   * MCP result disposition for this action. `'json'` (the default when unset)
   * formats the response with `jsonToolResult` (compact JSON text); `'smart'`
   * uses `smartToolResult` (inlines small payloads, offloads large ones to an
   * embedded resource); `'structured'` declares the `output` schema as an MCP
   * `outputSchema` contract - the result is parsed through `output` (stripping
   * extra fields) and shipped as `structuredContent` alongside a JSON text
   * mirror. `'json'`/`'smart'` are only defaults a client's `_meta.disposition`
   * can override; a `'structured'` action ignores `_meta.disposition`, since
   * its schema contract is fixed at `tools/list` time. `'structured'` requires
   * a non-streaming action with an `output` schema (validated at registration
   * via `validateActionDisposition()`). Ignored by non-MCP adapters.
   */
  disposition?: 'json' | 'smart' | 'structured'
  /**
   * MCP tool annotations forwarded to `tools/list`. When unset, MCP adapters
   * derive `readOnlyHint` from `kind` (`'query'` ⇒ read-only); explicit
   * annotations are merged over the derived base, so setting e.g. only
   * `destructiveHint` keeps the derived `readOnlyHint`. Ignored by non-MCP
   * adapters.
   */
  annotations?: ToolAnnotations
  /**
   * Free-form grouping labels (e.g. `['leads', 'write']`). Carried on the
   * action for per-request filtering (`filterActions` in the MCP adapters) and
   * other consumers; no behavior in core itself.
   */
  tags?: string[]
  isEnabled?: (context: SilkweaveContext) => boolean
  run: ActionRun<I, O> | ActionStreamRun<I, C>
  toolResult?: (response: O, context: SilkweaveContext) => ToolResult | undefined
}

export interface NonStreamingActionInput<I extends object, O extends object, N extends string, K extends ActionKind> {
  name: N
  description: string
  input: z.ZodType<I> & { shape: Record<string, z.ZodTypeAny> }
  output?: z.ZodType<O> & { shape: Record<string, z.ZodTypeAny> }
  kind?: K
  method?: HttpMethod
  path?: string
  queryParams?: (keyof I)[]
  args?: (keyof I)[]
  disposition?: 'json' | 'smart' | 'structured'
  annotations?: ToolAnnotations
  tags?: string[]
  isEnabled?: (context: SilkweaveContext) => boolean
  run: ActionRun<I, O>
  toolResult?: (response: O, context: SilkweaveContext) => ToolResult | undefined
}

export interface StreamingActionInput<I extends object, C, N extends string, K extends ActionKind> {
  name: N
  description: string
  input: z.ZodType<I> & { shape: Record<string, z.ZodTypeAny> }
  chunk: z.ZodType<C>
  kind?: K
  method?: HttpMethod
  path?: string
  queryParams?: (keyof I)[]
  args?: (keyof I)[]
  disposition?: 'json' | 'smart'
  annotations?: ToolAnnotations
  tags?: string[]
  isEnabled?: (context: SilkweaveContext) => boolean
  run: ActionStreamRun<I, C>
  toolResult?: (response: C[], context: SilkweaveContext) => ToolResult | undefined
}

export function createAction<I extends object, C, N extends string, K extends ActionKind = 'mutation'>(
  action: StreamingActionInput<I, C, N, K>
): StreamingActionInput<I, C, N, K>
export function createAction<I extends object, O extends object, N extends string, K extends ActionKind = 'mutation'>(
  action: NonStreamingActionInput<I, O, N, K>
): NonStreamingActionInput<I, O, N, K>
export function createAction(action: Action): Action {
  return action
}

/**
 * Returns `true` when `action.run` is an async generator function (declared
 * with `async function*`). Adapters use this to switch between buffered
 * request/response and streaming chunk delivery.
 */
export function isStreamingAction(action: Action): boolean {
  return action.run?.constructor?.name === 'AsyncGeneratorFunction'
}

/**
 * Validate an action's MCP `disposition` at registration time. `'structured'`
 * declares the `output` schema as a hard MCP `outputSchema` contract, so it
 * requires a non-streaming action with an `output` schema - anything else is a
 * misconfiguration surfaced at boot rather than a per-call protocol error.
 * MCP adapters call this from `start()` (or, for per-request transports, when
 * the handler is built).
 */
export function validateActionDisposition(action: Action): void {
  if (action.chunk && isBinarySchema(action.chunk)) {
    throw new SilkweaveError(
      `Action '${action.name}': binary() cannot be a chunk schema - streaming binary resources is not supported; return a single resource from a non-streaming action instead`,
      'invalid_action'
    )
  }
  if (action.disposition !== 'structured') {
    return
  }
  if (isBinarySchema(action.output)) {
    throw new SilkweaveError(
      `Action '${action.name}': disposition 'structured' cannot back a binary() output - there is no JSON outputSchema contract for binary data; use the default disposition instead`,
      'invalid_action'
    )
  }
  if (isStreamingAction(action) || action.chunk) {
    throw new SilkweaveError(
      `Action '${action.name}': disposition 'structured' is not supported on a streaming action - there is no single result to validate against an output schema`,
      'invalid_action'
    )
  }
  if (!action.output) {
    throw new SilkweaveError(
      `Action '${action.name}': disposition 'structured' requires an 'output' schema - it becomes the tool's MCP outputSchema contract`,
      'invalid_action'
    )
  }
  if (action.toolResult) {
    // A `toolResult` hook returns a ToolResult that would bypass the
    // schema-parsed `structuredContent`, so the SDK's outputSchema validation
    // would reject every call. The two are mutually exclusive by construction.
    throw new SilkweaveError(
      `Action '${action.name}': a 'toolResult' hook cannot be combined with disposition 'structured' - the hook would bypass the structuredContent the outputSchema contract requires`,
      'invalid_action'
    )
  }
}
