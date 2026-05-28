import type { HttpAdapterHost } from '@nestjs/core'
import type { Action, SilkweaveContext, SilkweaveOptions } from '@silkweave/core'

/**
 * Context passed to a Nest Silkweave adapter when `SilkweaveModule` wires it
 * up. Adapters register their routes directly on `httpAdapter` (no
 * placeholder middleware, no `silkweave()` builder), so they only fire
 * `register()` once and own the rest of their lifecycle implicitly through
 * Nest.
 */
export interface NestAdapterRegisterContext {
  /** Nest's underlying HTTP adapter (Express or Fastify). */
  httpAdapter: NonNullable<HttpAdapterHost['httpAdapter']>
  /** Identity the adapter surfaces to clients (e.g. MCP server name). */
  silkweaveOptions: SilkweaveOptions
  /** Per-adapter context - already forked with `{ adapter: adapter.name, ...userContext }`. */
  baseContext: SilkweaveContext
  /** Actions filtered to those enabled on this adapter. */
  actions: Action[]
}

/**
 * A Silkweave Nest adapter. Each transport (REST, tRPC, MCP) implements this
 * shape. `register()` is called from `SilkweaveModule.configure()` - which
 * runs *before* Nest's controller routes are mapped - so adapter routes
 * always sit ahead of any catch-all controllers in the framework's request
 * pipeline.
 */
export interface NestSilkweaveAdapter {
  /** Adapter discriminator - set on the silkweave context as `ctx.get('adapter')`. */
  readonly name: 'rest' | 'trpc' | 'mcp' | 'typegen'
  /**
   * When `true`, the adapter receives every discovered action regardless of
   * each action's `transports` allowlist / `isEnabled` gate. Used by
   * non-runtime adapters like `typegen()` that emit types for the entire
   * action surface.
   */
  readonly allActions?: boolean
  /** Register this adapter's routes on Nest's HTTP server. */
  register(ctx: NestAdapterRegisterContext): void
}

export interface SilkweaveModuleOptions {
  /** Identity for the silkweave instance - surfaced to MCP clients, OpenAPI, etc. */
  silkweave: SilkweaveOptions
  /** Adapters to mount. Examples: `rest()`, `trpc()`, `mcp()`. */
  adapters: NestSilkweaveAdapter[]
  /** Initial context keys merged into every adapter's `baseContext`. */
  context?: Record<string, unknown>
}

export const SILKWEAVE_MODULE_OPTIONS = '__silkweave_module_options__'
