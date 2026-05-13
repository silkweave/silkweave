import type { HttpAdapterHost } from '@nestjs/core'
import type { AdapterGenerator, SilkweaveOptions } from '@silkweave/core'

/**
 * A Silkweave NestJS adapter. Each transport (REST, tRPC, MCP) implements this
 * shape: given a Nest `HttpAdapterHost`, it (a) immediately mounts a
 * placeholder middleware slot on Nest's running HTTP server during
 * `OnModuleInit` — which is critical because Nest installs its 404 catch-all
 * later in `init()`, before `OnApplicationBootstrap` fires; routes registered
 * after the catch-all are unreachable — and (b) returns a core
 * `AdapterGenerator` whose `start(actions)` populates that slot with the real
 * handler.
 *
 * Adapters mount onto Nest's HTTP server instead of owning their own, so Nest
 * middleware, lifecycle hooks, and request scoping remain coherent.
 */
export interface NestSilkweaveAdapter {
  /** Adapter discriminator — set on the silkweave context as `ctx.get('adapter')`. */
  readonly name: 'rest' | 'trpc' | 'mcp'
  /**
   * Reserve the adapter's route prefix on the Nest HTTP server *now* (before
   * Nest's 404 catch-all is installed) and return the core `AdapterGenerator`
   * that will populate the slot during `silkweave().start()`.
   */
  install(host: HttpAdapterHost): AdapterGenerator
}

export interface SilkweaveModuleOptions {
  /** Identity for the silkweave instance — surfaced to MCP clients, OpenAPI, etc. */
  silkweave: SilkweaveOptions
  /** Adapters to mount. Examples: `rest()`, `trpc()`, `mcp()`. */
  adapters: NestSilkweaveAdapter[]
  /** Initial context keys (equivalent to chaining `.set(key, value)` on the builder). */
  context?: Record<string, unknown>
}

export const SILKWEAVE_MODULE_OPTIONS = '__silkweave_module_options__'
