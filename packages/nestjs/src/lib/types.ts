import type { CanActivate, Type } from '@nestjs/common'
import type { HttpAdapterHost } from '@nestjs/core'
import type { Action, OnToolCall, SilkweaveContext, SilkweaveOptions, ToolCallEvent } from '@silkweave/core'
import type { OpenApiDocument } from './reflect/openapi.js'

/**
 * Telemetry service contract for `SilkweaveModuleOptions.telemetry`. Implement
 * it as a regular injectable provider (it can inject your logger, config,
 * repositories) and pass the **class token** to `forRoot` - it is resolved
 * through DI at call time.
 *
 * `onToolCall` fires once per tool/procedure invocation, fire-and-forget:
 * never awaited on the call path, errors logged and swallowed. MCP events are
 * emitted from the MCP registrar (and carry `resultBytes`/`sideloaded`); tRPC
 * events from the synthesized action wrapper (guard denials included) -
 * exactly one event per call either way.
 */
export interface SilkweaveTelemetry {
  onToolCall(event: ToolCallEvent): void | Promise<void>
}

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
  /**
   * Telemetry emitter resolved from `SilkweaveModuleOptions.telemetry` (when
   * configured). The `mcp()` adapter threads it into the MCP registrar so MCP
   * events carry the result metadata only that layer knows.
   */
  onToolCall?: OnToolCall
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
  readonly name: 'mcp' | 'trpc' | 'typegen'
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
  /** Adapters to mount - any of `mcp()`, `trpc()`, `typegen()`. */
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
  /**
   * Opt-in allow-list of app-global guard classes (registered via
   * `app.useGlobalGuards()` or `{ provide: APP_GUARD, useClass }`) to run on
   * every MCP tool call, before each method/class `@UseGuards`. Listed by
   * class - a blanket "run all globals" is deliberately not offered, since
   * unrelated globals (e.g. a `ThrottlerGuard` that needs a writable response)
   * would misbehave over MCP. Empty/omitted ⇒ no global guards run.
   *
   * Note: over MCP the request stand-in is headers-only (`params`/`query` are
   * empty), so per-session or IP-derived guard logic won't apply; header-based
   * authentication still works.
   */
  globalGuards?: Type<CanActivate>[]
  /**
   * Default MCP result format for every `@Mcp` tool - `'json'` (compact JSON,
   * `jsonToolResult`) or `'smart'` (inline small / embedded-resource large,
   * `smartToolResult`). Defaults to `'json'` (since 3.2; was `'smart'`). A
   * per-method `@Mcp({ result })` overrides this, and a client's per-call
   * `_meta.disposition` overrides both.
   */
  defaultResult?: 'json' | 'smart'
  /**
   * Class token of a `SilkweaveTelemetry` provider, resolved through DI at
   * call time (so it can inject your logger/config). One `onToolCall` event
   * fires per tool/procedure invocation across MCP and tRPC - see
   * `SilkweaveTelemetry` for the seam split and event fields.
   */
  telemetry?: Type<SilkweaveTelemetry>
}

export const SILKWEAVE_MODULE_OPTIONS = '__silkweave_module_options__'
