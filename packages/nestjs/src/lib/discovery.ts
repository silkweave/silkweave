/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { Injectable, type Type } from '@nestjs/common'
import { DiscoveryService, MetadataScanner, ModuleRef, Reflector } from '@nestjs/core'
import { createAction, type Action, type ActionKind, type SilkweaveContext, type StreamingActionInput } from '@silkweave/core'
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
  ) { }

  /**
   * Walk every Nest provider, find methods annotated with `@Action`, and build
   * a list of core `Action` objects ready to feed into `silkweave().actions()`.
   *
   * Action invocation is wrapped to (a) run `@UseGuards` guards declared on the
   * method or its class against the incoming request (read from
   * `ctx.get('request')`, populated by REST/tRPC and by MCP-over-HTTP from the
   * SDK's `extra.requestInfo`) and (b) bind `this` to the resolved Nest provider
   * so DI-injected dependencies remain available.
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

    const applyGuards = async (context: SilkweaveContext): Promise<void> => {
      if (guards.length === 0) { return }
      // REST and tRPC populate `request`/`response`; MCP-over-HTTP populates
      // `request` (a `{ headers, url, params, query }` stand-in built from the
      // SDK's `extra.requestInfo`). Transports with no HTTP request at all (e.g.
      // MCP stdio) get a header-less stand-in so guards reading `req.headers`
      // degrade gracefully (deny) instead of dereferencing `undefined`.
      const request = context.getOptional<unknown>('request')
      const response = context.getOptional<unknown>('response') ?? null
      const hasRequest = request != null
      const guardRequest = hasRequest ? request : { headers: {}, params: {}, query: {} }
      await runGuards(guards, moduleRef, reflector, d.classRef, d.method, guardRequest, response, hasRequest ? 'http' : 'rpc')
    }

    // Cast at the createAction boundary to bridge dual-zod-version installs
    // (zod@3.25 + zod@4.x can both be present transitively). Runtime is fine -
    // they share the same /v4 surface - but the structural types are distinct.
    const streaming = d.method.constructor?.name === 'AsyncGeneratorFunction'

    if (streaming) {
      if (!d.meta.chunk) {
        throw new Error(`@Action "${name}" is an async generator but has no \`chunk\` schema`)
      }
      const method = d.method
      const instance = d.instance
      return createAction({
        name,
        description: d.meta.description,
        input: d.meta.input,
        chunk: d.meta.chunk,
        kind: d.meta.kind ?? 'mutation',
        method: d.meta.method,
        path: d.meta.path,
        queryParams: d.meta.queryParams,
        args: d.meta.args,
        isEnabled,
        toolResult: d.meta.toolResult,
        run: async function* (input: object, context: SilkweaveContext) {
          await applyGuards(context)
          yield* (method.call(instance, input, context) as AsyncGenerator<object, void, void>)
        }
      } as StreamingActionInput<object, unknown, string, ActionKind>) as Action
    }

    return createAction({
      name,
      description: d.meta.description,
      input: d.meta.input,
      output: d.meta.output,
      kind: d.meta.kind ?? 'mutation',
      method: d.meta.method,
      path: d.meta.path,
      queryParams: d.meta.queryParams,
      args: d.meta.args,
      isEnabled,
      toolResult: d.meta.toolResult,
      run: async (input: object, context: SilkweaveContext): Promise<object> => {
        await applyGuards(context)
        const result = await (d.method.call(d.instance, input, context) as Promise<object>)
        return result
      }
    })
  }
}
