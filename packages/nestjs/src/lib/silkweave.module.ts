import { Inject, Module, type DynamicModule, type MiddlewareConsumer, type NestModule } from '@nestjs/common'
import { DiscoveryModule, HttpAdapterHost } from '@nestjs/core'
import { createContext } from '@silkweave/core'
import { ActionDiscovery } from './discovery.js'
import { SILKWEAVE_MODULE_OPTIONS, type SilkweaveModuleOptions } from './types.js'

/**
 * Root module for `@silkweave/nestjs`.
 *
 * Discovers every `@Action`-decorated method via `DiscoveryService` and
 * registers the configured adapters (`rest()`, `trpc()`, `mcp()`) directly on
 * Nest's HTTP adapter inside `configure()`. Because `configure()` runs during
 * `registerModules` - before Nest's `registerRouter()` step - Silkweave's
 * routes always sit ahead of every controller in the Express stack. There is
 * no slot middleware, no race with Nest's 404 catch-all, and every route
 * shows up in Nest's `RoutesResolver` logger.
 *
 * @example
 * ```ts
 * @Module({
 *   imports: [
 *     SilkweaveModule.forRoot({
 *       silkweave: { name: 'app', description: 'My App', version: '1.0.0' },
 *       adapters: [
 *         rest({ basePath: '/api' }),
 *         trpc({ basePath: '/trpc' }),
 *         mcp({ basePath: '/mcp' })
 *       ]
 *     })
 *   ]
 * })
 * export class AppModule {}
 * ```
 */
@Module({})
export class SilkweaveModule implements NestModule {
  constructor(
    @Inject(SILKWEAVE_MODULE_OPTIONS) private readonly options: SilkweaveModuleOptions,
    private readonly discovery: ActionDiscovery,
    private readonly httpAdapterHost: HttpAdapterHost
  ) { }

  static forRoot(options: SilkweaveModuleOptions): DynamicModule {
    return {
      module: SilkweaveModule,
      global: true,
      imports: [DiscoveryModule],
      providers: [
        { provide: SILKWEAVE_MODULE_OPTIONS, useValue: options },
        ActionDiscovery
      ],
      exports: []
    }
  }

  configure(_consumer: MiddlewareConsumer): void {
    const httpAdapter = this.httpAdapterHost.httpAdapter
    if (!httpAdapter) {
      throw new Error('@silkweave/nestjs: HttpAdapterHost.httpAdapter is not available.')
    }
    const allActions = this.discovery.discover()
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
