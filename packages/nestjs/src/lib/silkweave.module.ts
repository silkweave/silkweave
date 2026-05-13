import { Module, type DynamicModule } from '@nestjs/common'
import { DiscoveryModule } from '@nestjs/core'
import { ActionDiscovery } from './discovery.js'
import { SilkweaveService } from './silkweave.service.js'
import { SILKWEAVE_MODULE_OPTIONS, type SilkweaveModuleOptions } from './types.js'

/**
 * Root module for `@silkweave/nestjs`.
 *
 * Discovers every `@Action`-decorated method across the Nest app via
 * `DiscoveryService`, builds core `Action` objects from them, and mounts the
 * configured adapters (`rest()`, `trpc()`, `mcp()`) onto Nest's running HTTP
 * server during `OnApplicationBootstrap`.
 *
 * @example
 * ```ts
 * import { Module } from '@nestjs/common'
 * import { SilkweaveModule, rest, trpc, mcp } from '@silkweave/nestjs'
 * import { UsersModule } from './users.module.js'
 *
 * @Module({
 *   imports: [
 *     SilkweaveModule.forRoot({
 *       silkweave: { name: 'app', description: 'My App', version: '1.0.0' },
 *       adapters: [
 *         rest({ basePath: '/api' }),
 *         trpc({ basePath: '/trpc' }),
 *         mcp({ basePath: '/mcp' })
 *       ]
 *     }),
 *     UsersModule
 *   ]
 * })
 * export class AppModule {}
 * ```
 */
@Module({})
export class SilkweaveModule {
  static forRoot(options: SilkweaveModuleOptions): DynamicModule {
    return {
      module: SilkweaveModule,
      global: true,
      imports: [DiscoveryModule],
      providers: [
        { provide: SILKWEAVE_MODULE_OPTIONS, useValue: options },
        ActionDiscovery,
        SilkweaveService
      ],
      exports: [SilkweaveService]
    }
  }
}
