import { Inject, Injectable, type OnApplicationBootstrap, type OnApplicationShutdown, type OnModuleInit } from '@nestjs/common'
import { HttpAdapterHost } from '@nestjs/core'
import { type AdapterGenerator, silkweave as createSilkweave, type Silkweave } from '@silkweave/core'
import { ActionDiscovery } from './discovery.js'
import { SILKWEAVE_MODULE_OPTIONS, type SilkweaveModuleOptions } from './types.js'

/**
 * Coordinates the Nest lifecycle for `@silkweave/nestjs`:
 *
 * - `onModuleInit`: each configured adapter calls `install(host)` to reserve a
 *   placeholder middleware slot at its base path. This must happen here, not
 *   in `onApplicationBootstrap`, because Nest installs its 404 catch-all later
 *   during `init()` — routes registered after the catch-all are unreachable.
 *
 * - `onApplicationBootstrap`: discovers every `@Action` method, then drives the
 *   standard `silkweave().adapter(...).actions(...).start()` flow, which calls
 *   each adapter's `start(actions)` to populate the slot reserved earlier.
 */
@Injectable()
export class SilkweaveService implements OnModuleInit, OnApplicationBootstrap, OnApplicationShutdown {
  private builder?: Silkweave
  private readonly generators: AdapterGenerator[] = []

  constructor(
    @Inject(SILKWEAVE_MODULE_OPTIONS) private readonly options: SilkweaveModuleOptions,
    private readonly discovery: ActionDiscovery,
    private readonly httpAdapterHost: HttpAdapterHost
  ) {}

  onModuleInit(): void {
    for (const adapter of this.options.adapters) {
      this.generators.push(adapter.install(this.httpAdapterHost))
    }
  }

  async onApplicationBootstrap(): Promise<void> {
    const actions = this.discovery.discover()
    const builder = createSilkweave(this.options.silkweave)
    for (const [key, value] of Object.entries(this.options.context ?? {})) {
      builder.set(key, value)
    }
    for (const gen of this.generators) {
      builder.adapter(gen)
    }
    builder.actions(actions)
    await builder.start()
    this.builder = builder
  }

  async onApplicationShutdown(): Promise<void> {
    this.builder = undefined
  }

  /** Access the underlying silkweave builder once bootstrap has completed. */
  getBuilder(): Silkweave | undefined {
    return this.builder
  }
}
