import { Injectable, type Type } from '@nestjs/common'
import { DiscoveryService, MetadataScanner, ModuleRef, Reflector } from '@nestjs/core'
import { createAction, type Action, type SilkweaveContext } from '@silkweave/core'
import { kebabCase } from 'change-case'
import { buildIsEnabled } from './filter.js'
import { collectGuards, runGuards } from './guards.js'
import { ACTION_METADATA, ACTIONS_METADATA, type ActionMetadata, type ActionsClassMetadata } from './metadata.js'

interface DiscoveredAction {
  instance: object
  classRef: Type<unknown>
  method: (...args: unknown[]) => unknown
  methodName: string
  meta: ActionMetadata
  classMeta: ActionsClassMetadata
}

@Injectable()
export class ActionDiscovery {
  constructor(
    private readonly discovery: DiscoveryService,
    private readonly scanner: MetadataScanner,
    private readonly reflector: Reflector,
    private readonly moduleRef: ModuleRef
  ) {}

  /**
   * Walk every Nest provider, find methods annotated with `@Action`, and build
   * a list of core `Action` objects ready to feed into `silkweave().actions()`.
   *
   * Action invocation is wrapped to (a) run `@UseGuards` guards declared on the
   * method or its class against the incoming HTTP request (read from
   * `ctx.get('request')`) and (b) bind `this` to the resolved Nest provider so
   * DI-injected dependencies remain available.
   */
  discover(): Action[] {
    const discovered: DiscoveredAction[] = []
    const wrappers = this.discovery.getProviders()
    for (const wrapper of wrappers) {
      const { instance } = wrapper
      if (!instance || typeof instance !== 'object') { continue }
      const proto = Object.getPrototypeOf(instance) as object | null
      if (!proto) { continue }
      const classRef = instance.constructor as Type<unknown>
      const classMeta = (this.reflector.get<ActionsClassMetadata>(ACTIONS_METADATA, classRef) ?? {})
      for (const methodName of this.scanner.getAllMethodNames(proto)) {
        const method = (proto as Record<string, unknown>)[methodName] as ((...args: unknown[]) => unknown) | undefined
        if (typeof method !== 'function') { continue }
        const meta = this.reflector.get<ActionMetadata>(ACTION_METADATA, method)
        if (!meta) { continue }
        discovered.push({ instance, classRef, method, methodName, meta, classMeta })
      }
    }
    return discovered.map((d) => this.toAction(d))
  }

  private toAction(d: DiscoveredAction): Action {
    const baseName = d.meta.name ?? kebabCase(d.methodName)
    const name = d.classMeta.prefix ? `${d.classMeta.prefix}.${baseName}` : baseName
    const transports = d.meta.transports ?? d.classMeta.transports
    const isEnabled = buildIsEnabled(transports, d.meta.isEnabled)
    const guards = collectGuards(this.reflector, d.classRef, d.method)
    const moduleRef = this.moduleRef
    const reflector = this.reflector

    // Cast at the createAction boundary to bridge dual-zod-version installs
    // (zod@3.25 + zod@4.x can both be present transitively). Runtime is fine —
    // they share the same /v4 surface — but the structural types are distinct.
    type CreateActionArg = Parameters<typeof createAction>[0]
    return createAction({
      name,
      description: d.meta.description,
      input: d.meta.input as unknown as CreateActionArg['input'],
      output: d.meta.output as unknown as CreateActionArg['output'],
      kind: d.meta.kind ?? 'mutation',
      args: d.meta.args as CreateActionArg['args'],
      isEnabled,
      toolResult: d.meta.toolResult as CreateActionArg['toolResult'],
      run: async (input: object, context: SilkweaveContext): Promise<object> => {
        if (guards.length > 0) {
          const request = context.getOptional<unknown>('request')
          const response = context.getOptional<unknown>('response')
          await runGuards(guards, moduleRef, reflector, d.classRef, d.method, request, response)
        }
        const result = await (d.method.call(d.instance, input, context) as Promise<object>)
        return result
      }
    })
  }
}
