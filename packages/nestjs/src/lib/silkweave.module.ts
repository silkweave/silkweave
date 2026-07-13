import { Inject, Module, type DynamicModule, type MiddlewareConsumer, type NestModule } from '@nestjs/common'
import { DiscoveryModule, HttpAdapterHost, ModuleRef } from '@nestjs/core'
import { createContext, type OnToolCall } from '@silkweave/core'
import { ControllerDiscovery } from './controllerDiscovery.js'
import { SILKWEAVE_MODULE_OPTIONS, type SilkweaveModuleOptions, type SilkweaveTelemetry } from './types.js'

/**
 * Root module for `@silkweave/nestjs`.
 *
 * Discovers every `@Mcp`/`@Trpc`-decorated **controller method** via
 * `DiscoveryService`, reflects each into a Silkweave action (input schema from
 * the route + parameter decorators + optional OpenAPI document; invocation by
 * re-binding the validated input back into the method), and registers the
 * configured adapter(s) - `mcp()`, `trpc()`, `typegen()` - directly on Nest's
 * HTTP adapter inside `configure()`.
 *
 * Because `configure()` runs during `registerModules` - before Nest's
 * `registerRouter()` step - Silkweave's routes always sit ahead of every
 * controller in the Express stack. The controllers keep serving HTTP exactly as
 * before; `@Mcp` is purely additive.
 *
 * @example
 * ```ts
 * @Module({
 *   imports: [
 *     SilkweaveModule.forRoot({
 *       silkweave: { name: 'app', description: 'My App', version: '1.0.0' },
 *       adapters: [mcp({ basePath: '/mcp' })]
 *     })
 *   ],
 *   controllers: [ChannelsController]
 * })
 * export class AppModule {}
 * ```
 */
@Module({})
export class SilkweaveModule implements NestModule {
  constructor(
    @Inject(SILKWEAVE_MODULE_OPTIONS) private readonly options: SilkweaveModuleOptions,
    private readonly discovery: ControllerDiscovery,
    private readonly httpAdapterHost: HttpAdapterHost,
    private readonly moduleRef: ModuleRef
  ) { }

  /**
   * Build the telemetry emitter from the configured class token. The instance
   * is resolved through DI lazily on first event (and memoized) - `configure()`
   * runs before providers are guaranteed ready, same reason global guards
   * resolve at call time.
   */
  private telemetryEmitter(): OnToolCall | undefined {
    const token = this.options.telemetry
    if (!token) { return undefined }
    let instance: SilkweaveTelemetry | undefined
    return (event) => {
      const resolved = instance ?? this.moduleRef.get<SilkweaveTelemetry>(token, { strict: false })
      instance = resolved
      return resolved.onToolCall(event)
    }
  }

  static forRoot(options: SilkweaveModuleOptions): DynamicModule {
    return {
      module: SilkweaveModule,
      global: true,
      imports: [DiscoveryModule],
      providers: [
        { provide: SILKWEAVE_MODULE_OPTIONS, useValue: options },
        ControllerDiscovery
      ],
      exports: []
    }
  }

  configure(_consumer: MiddlewareConsumer): void {
    const httpAdapter = this.httpAdapterHost.httpAdapter
    if (!httpAdapter) {
      throw new Error('@silkweave/nestjs: HttpAdapterHost.httpAdapter is not available.')
    }
    const onToolCall = this.telemetryEmitter()
    const allActions = this.discovery.discover({
      openapi: this.options.openapi,
      globalGuards: this.options.globalGuards,
      defaultResult: this.options.defaultResult,
      // tRPC events come from the synthesized action wrapper; MCP events from
      // the MCP registrar (via each adapter's register context) - one per call.
      onToolCall
    })
    for (const adapter of this.options.adapters) {
      const baseContext = createContext({ ...(this.options.context ?? {}), adapter: adapter.name })
      const actions = adapter.allActions
        ? allActions
        : allActions.filter((a) => !a.isEnabled || a.isEnabled(baseContext))
      adapter.register({
        httpAdapter,
        silkweaveOptions: this.options.silkweave,
        baseContext,
        actions,
        onToolCall
      })
    }
  }
}
