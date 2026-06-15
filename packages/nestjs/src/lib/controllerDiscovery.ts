/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { Injectable, type Type } from '@nestjs/common'
import { DiscoveryService, MetadataScanner, ModuleRef, Reflector } from '@nestjs/core'
import { createAction, type Action, type SilkweaveContext } from '@silkweave/core'
import { z } from 'zod/v4'
import { collectGuards, runGuards } from './guards.js'
import { MCP_METADATA, type McpMetadata } from './metadata.js'
import { invokeRebound, specialBinding, type Binding } from './rebind.js'
import { buildOpenApiLookup, openApiFields, type OpenApiDocument, type OpenApiLookup } from './reflect/openapi.js'
import { PARAMTYPE, type ParamSlot, readParamSlots } from './reflect/params.js'
import { reflectRoute } from './reflect/route.js'
import { type FieldDesc, fieldToZod, mergeField, reflectDtoFields } from './reflect/schema.js'
import { reflectOperation } from './reflect/swagger.js'

interface DiscoveredMcp {
  instance: object
  classRef: Type<unknown>
  method: (...args: unknown[]) => unknown
  methodName: string
  meta: McpMetadata
}

interface BuiltInput {
  shape: Record<string, z.ZodType>
  bindings: Binding[]
}

@Injectable()
export class ControllerDiscovery {
  constructor(
    private readonly discovery: DiscoveryService,
    private readonly scanner: MetadataScanner,
    private readonly reflector: Reflector,
    private readonly moduleRef: ModuleRef
  ) { }

  /**
   * Walk every Nest provider/controller, find methods annotated with `@Mcp`,
   * and build a core `Action` per method whose input schema is reflected from
   * the route + parameter decorators (+ optional OpenAPI document) and whose
   * `run` re-binds the validated input back into the method's positional
   * arguments (with `@UseGuards` guards applied first).
   */
  discover(openapi?: OpenApiDocument): Action[] {
    const lookup = openapi ? buildOpenApiLookup(openapi) : undefined
    const discovered: DiscoveredMcp[] = []
    for (const wrapper of this.discovery.getProviders().concat(this.discovery.getControllers())) {
      const { instance } = wrapper
      if (!instance || typeof instance !== 'object') { continue }
      const proto = Object.getPrototypeOf(instance) as object | null
      if (!proto) { continue }
      const classRef = instance.constructor as Type<unknown>
      for (const methodName of this.scanner.getAllMethodNames(proto)) {
        const method = (proto as Record<string, unknown>)[methodName] as ((...args: unknown[]) => unknown) | undefined
        if (typeof method !== 'function') { continue }
        const meta = this.reflector.get<McpMetadata>(MCP_METADATA, method)
        if (!meta) { continue }
        discovered.push({ instance, classRef, method, methodName, meta })
      }
    }
    return discovered.map((d) => this.toAction(d, lookup))
  }

  private toAction(d: DiscoveredMcp, lookup: OpenApiLookup | undefined): Action {
    const proto = Object.getPrototypeOf(d.instance) as object
    const route = reflectRoute(d.classRef, d.method)
    const slots = readParamSlots(d.classRef, d.methodName, proto)
    const operation = reflectOperation(d.method)
    const docFields = lookup ? openApiFields(lookup, route.method, route.openapiPath) : {}

    const { shape, bindings } = this.buildInput(d, route.pathParams, slots, operation.params, docFields)

    const base = d.classRef.name.replace(/Controller$/, '')
    const name = d.meta.name ?? `${base}.${d.methodName}`
    const description = d.meta.description ?? operation.description ?? `${d.methodName} (${route.method} /${route.path})`
    const applyParamPipes = d.meta.pipes !== 'skip'

    const guards = collectGuards(this.reflector, d.classRef, d.method)
    const { moduleRef, reflector } = this
    const classRef = d.classRef
    const method = d.method
    const instance = d.instance

    const applyGuards = async (context: SilkweaveContext): Promise<void> => {
      if (guards.length === 0) { return }
      const request = context.getOptional<unknown>('request')
      const response = context.getOptional<unknown>('response') ?? null
      const hasRequest = request != null
      const guardRequest = hasRequest ? request : { headers: {}, params: {}, query: {} }
      await runGuards(guards, moduleRef, reflector, classRef, method, guardRequest, response, hasRequest ? 'http' : 'rpc')
    }

    return createAction({
      name,
      description,
      input: z.object(shape),
      // Only the MCP adapter exposes `@Mcp` methods; a future `@Trpc` decorator
      // would tag its own actions for the tRPC adapter.
      isEnabled: (ctx) => ctx.getOptional<string>('adapter') === 'mcp',
      run: async (input: object, context: SilkweaveContext): Promise<object> => {
        await applyGuards(context)
        const request = context.getOptional<{ headers?: Record<string, unknown> }>('request')
        const result = await invokeRebound(method, instance, input as Record<string, unknown>, bindings, request, applyParamPipes)
        return (result ?? {})
      }
    }) as Action
  }

  /** Build the merged Zod input shape and the per-argument re-bind plan. */
  private buildInput(
    d: DiscoveredMcp,
    pathParams: string[],
    slots: ReturnType<typeof readParamSlots>,
    operationParams: Record<string, FieldDesc>,
    docFields: Record<string, FieldDesc>
  ): BuiltInput {
    const proto = Object.getPrototypeOf(d.instance) as object
    const designTypes = (Reflect.getMetadata('design:paramtypes', proto, d.methodName) as unknown[] | undefined) ?? []
    const fields: Record<string, FieldDesc> = {}
    const maxIndex = slots.reduce((m, s) => Math.max(m, s.index), -1)
    const bindings: Binding[] = Array.from({ length: maxIndex + 1 }, () => ({ kind: 'missing' as const }))

    const addField = (name: string, desc: FieldDesc): void => {
      fields[name] = name in fields ? mergeField(fields[name], desc) : desc
    }

    for (const slot of slots) {
      const { binding, fields: contributed } = contributeSlot(slot, pathParams, designTypes)
      bindings[slot.index] = binding
      for (const [name, desc] of Object.entries(contributed)) { addField(name, desc) }
    }

    // Layer operation-level (`@ApiParam`/`@ApiQuery`) then OpenAPI-document
    // metadata over the structural fields (later sources win per field).
    for (const [name, desc] of Object.entries(operationParams)) {
      if (name in fields) { fields[name] = mergeField(fields[name], desc) }
    }
    for (const [name, desc] of Object.entries(docFields)) {
      if (name in fields) { fields[name] = mergeField(fields[name], desc) }
    }

    const shape: Record<string, z.ZodType> = {}
    for (const [name, desc] of Object.entries(fields)) { shape[name] = fieldToZod(desc) }
    // `@Mcp({ input })` raw-shape override wins per field.
    Object.assign(shape, d.meta.input ?? {})

    return { shape, bindings }
  }
}

function designTypeAt(designTypes: unknown[], index: number): FieldDesc {
  const ctor = designTypes[index]
  if (ctor === String) { return { type: 'string' } }
  if (ctor === Number) { return { type: 'number' } }
  if (ctor === Boolean) { return { type: 'boolean' } }
  return {}
}

interface SlotContribution {
  binding: Binding
  /** Input fields this slot contributes, keyed by field name. */
  fields: Record<string, FieldDesc>
}

/** A `@Param('id')` scalar or a bare `@Param()` covering all path params. */
function paramContribution(slot: ParamSlot, pathParams: string[]): SlotContribution {
  if (slot.data) {
    return {
      binding: { kind: 'value', field: slot.data, source: 'path', metatype: slot.designType, pipes: slot.pipes },
      fields: { [slot.data]: { type: 'string', required: true } }
    }
  }
  const fields: Record<string, FieldDesc> = {}
  for (const p of pathParams) { fields[p] = { type: 'string', required: true } }
  return { binding: { kind: 'params', fields: pathParams }, fields }
}

/** A `@Query('x')`/`@Body('x')` scalar or a whole-DTO `@Query()`/`@Body()`. */
function bodyOrQueryContribution(slot: ParamSlot, source: 'query' | 'body', requiredScalar: boolean, designTypes: unknown[]): SlotContribution {
  if (slot.data) {
    return {
      binding: { kind: 'value', field: slot.data, source, metatype: slot.designType, pipes: slot.pipes },
      fields: { [slot.data]: mergeField(designTypeAt(designTypes, slot.index), { required: requiredScalar }) }
    }
  }
  const dtoFields = reflectDtoFields(slot.designType)
  return {
    binding: { kind: 'object', source, fields: Object.keys(dtoFields), metatype: slot.designType, pipes: slot.pipes },
    fields: dtoFields
  }
}

/** Map one parameter slot to its input-field contribution and re-bind instruction. */
function contributeSlot(slot: ParamSlot, pathParams: string[], designTypes: unknown[]): SlotContribution {
  switch (slot.paramtype) {
    case PARAMTYPE.PARAM: return paramContribution(slot, pathParams)
    case PARAMTYPE.QUERY: return bodyOrQueryContribution(slot, 'query', false, designTypes)
    case PARAMTYPE.BODY: return bodyOrQueryContribution(slot, 'body', true, designTypes)
    default: return { binding: specialBinding(slot.paramtype, slot.data) ?? { kind: 'missing' }, fields: {} }
  }
}
