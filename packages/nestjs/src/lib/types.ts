import type { HttpAdapterHost } from '@nestjs/core'
import type { Action, SilkweaveContext, SilkweaveOptions } from '@silkweave/core'
import type { OpenApiDocument } from './reflect/openapi.js'

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
  readonly name: 'mcp'
  /** URL prefix the adapter mounts on (e.g. `'/mcp'`). Surfaced for introspection. */
  readonly basePath?: string
  /**
   * When `true`, the adapter receives every discovered action regardless of
   * each action's `isEnabled` gate. Reserved for non-runtime adapters that need
   * the entire action surface.
   */
  readonly allActions?: boolean
  /** Register this adapter's routes on Nest's HTTP server. */
  register(ctx: NestAdapterRegisterContext): void
}

export interface SilkweaveModuleOptions {
  /** Identity for the silkweave instance - surfaced to MCP clients, OpenAPI, etc. */
  silkweave: SilkweaveOptions
  /** Adapters to mount. Currently `mcp()`. */
  adapters: NestSilkweaveAdapter[]
  /** Initial context keys merged into every adapter's `baseContext`. */
  context?: Record<string, unknown>
  /**
   * Optional OpenAPI document (e.g. from `SwaggerModule.createDocument(app, cfg)`)
   * used as an authoritative source when reflecting `@Mcp` tool input schemas.
   * Matched to each method by HTTP verb + path; falls back to decorator
   * reflection when an operation or field isn't present.
   */
  openapi?: OpenApiDocument
}

export const SILKWEAVE_MODULE_OPTIONS = '__silkweave_module_options__'
