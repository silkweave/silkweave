import { Inject, Module, type DynamicModule, type MiddlewareConsumer, type NestModule } from '@nestjs/common'
import { DiscoveryModule, HttpAdapterHost } from '@nestjs/core'
import { createContext } from '@silkweave/core'
import { ControllerDiscovery } from './controllerDiscovery.js'
import { SILKWEAVE_MODULE_OPTIONS, type SilkweaveModuleOptions } from './types.js'

/**
 * Root module for `@silkweave/nestjs`.
 *
 * Discovers every `@Mcp`-decorated **controller method** via `DiscoveryService`,
 * reflects each into a Silkweave action (input schema from the route + parameter
 * decorators + optional OpenAPI document; invocation by re-binding the validated
 * input back into the method), and registers the configured adapter(s) - `mcp()` -
 * directly on Nest's HTTP adapter inside `configure()`.
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
    private readonly httpAdapterHost: HttpAdapterHost
  ) { }

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
    const allActions = this.discovery.discover(this.options.openapi)
    for (const adapter of this.options.adapters) {
      const baseContext = createContext({ ...(this.options.context ?? {}), adapter: adapter.name })
      const actions = adapter.allActions
        ? allActions
        : allActions.filter((a) => !a.isEnabled || a.isEnabled(baseContext))
      adapter.register({
        httpAdapter,
        silkweaveOptions: this.options.silkweave,
        baseContext,
        actions
      })
    }
  }
}
