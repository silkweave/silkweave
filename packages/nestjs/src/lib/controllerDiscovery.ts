/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { HttpException, Injectable, Logger, type CanActivate, type Type } from '@nestjs/common'
import { ApplicationConfig, DiscoveryService, MetadataScanner, ModuleRef, Reflector } from '@nestjs/core'
import { SilkweaveError, type Action, type ActionKind, type SilkweaveContext, type ToolAnnotations } from '@silkweave/core'
import { z } from 'zod/v4'
import { collectGlobalGuards, collectGuards, runGuards } from './guards.js'
import { MCP_METADATA, TRPC_METADATA, type McpMetadata, type TrpcMetadata } from './metadata.js'
import { invokeRebound, specialBinding, type Binding } from './rebind.js'
import { populateRequestSlots, requestSlotFields, type RequestSlots } from './requestSlots.js'
import { buildOpenApiLookup, openApiFields, type OpenApiDocument, type OpenApiLookup } from './reflect/openapi.js'
import { PARAMTYPE, type ParamSlot, readParamSlots } from './reflect/params.js'
import { reflectDtoSchema, reflectResponseFields, reflectResponseSchema } from './reflect/response.js'
import { reflectRoute, type RouteInfo } from './reflect/route.js'
import { type FieldDesc, fieldToZod, mergeField, reflectDtoFields, unreflectedFields } from './reflect/schema.js'
import { reflectOperation } from './reflect/swagger.js'

/** Discovery-time diagnostics (unreflectable params, degraded outputs). */
const logger = new Logger('Silkweave')

interface Discovered {
  instance: object
  classRef: Type<unknown>
  method: (...args: unknown[]) => unknown
  methodName: string
  mcp?: McpMetadata
  trpc?: TrpcMetadata
}

interface BuiltInput {
  shape: Record<string, z.ZodType>
  bindings: Binding[]
  /** Human-readable notes about params reflection could not turn into fields. */
  warnings: string[]
}

/** Shared reflection computed once per discovered method, reused across targets. */
interface Reflected {
  route: RouteInfo
  base: string
  description?: string
  baseShape: Record<string, z.ZodType>
  bindings: Binding[]
  guards: ReturnType<typeof collectGuards>
  requestSlots: RequestSlots
  streaming: boolean
}

export interface DiscoverOptions {
  openapi?: OpenApiDocument
  globalGuards?: Type<CanActivate>[]
  defaultResult?: 'json' | 'smart'
}

@Injectable()
export class ControllerDiscovery {
  constructor(
    private readonly discovery: DiscoveryService,
    private readonly scanner: MetadataScanner,
    private readonly reflector: Reflector,
    private readonly moduleRef: ModuleRef,
    private readonly appConfig: ApplicationConfig
  ) { }

  /**
   * Walk every Nest provider/controller, find methods annotated with `@Mcp`
   * and/or `@Trpc`, and build a core `Action` per decorator present on each
   * method. The input schema is reflected from the route + parameter decorators
   * (+ optional OpenAPI document) and the `run` re-binds the validated input back
   * into the method's positional arguments (with `@UseGuards` guards applied
   * first). A method carrying both decorators yields two actions - one gated to
   * the `mcp` adapter, one to the `trpc`/`typegen` adapters - sharing the same
   * reflected input, bindings, and guards.
   */
  discover(options: DiscoverOptions = {}): Action[] {
    const lookup = options.openapi ? buildOpenApiLookup(options.openapi) : undefined
    const discovered: Discovered[] = []
    for (const wrapper of this.discovery.getProviders().concat(this.discovery.getControllers())) {
      const { instance } = wrapper
      if (!instance || typeof instance !== 'object') { continue }
      const proto = Object.getPrototypeOf(instance) as object | null
      if (!proto) { continue }
      const classRef = instance.constructor as Type<unknown>
      for (const methodName of this.scanner.getAllMethodNames(proto)) {
        const method = (proto as Record<string, unknown>)[methodName] as ((...args: unknown[]) => unknown) | undefined
        if (typeof method !== 'function') { continue }
        const mcp = this.reflector.get<McpMetadata>(MCP_METADATA, method)
        const trpc = this.reflector.get<TrpcMetadata>(TRPC_METADATA, method)
        if (!mcp && !trpc) { continue }
        discovered.push({ instance, classRef, method, methodName, mcp, trpc })
      }
    }

    const globalGuards = options.globalGuards ?? []
    const actions: Action[] = []
    for (const d of discovered) {
      const shared = this.reflect(d, lookup)
      if (d.mcp) { actions.push(this.mcpAction(d, shared, globalGuards, options.defaultResult)) }
      if (d.trpc) { actions.push(this.trpcAction(d, shared, globalGuards)) }
    }
    return actions
  }

  /** Compute the per-method reflection shared by the `mcp` and `trpc` builders. */
  private reflect(d: Discovered, lookup: OpenApiLookup | undefined): Reflected {
    const proto = Object.getPrototypeOf(d.instance) as object
    const route = reflectRoute(d.classRef, d.method)
    const slots = readParamSlots(d.classRef, d.methodName, proto)
    const operation = reflectOperation(d.method)
    const docFields = lookup ? openApiFields(lookup, route.method, route.openapiPath) : {}

    const { shape, bindings, warnings } = buildInput(proto, d.methodName, route.pathParams, slots, operation.params, docFields)
    for (const w of warnings) { logger.warn(`${d.classRef.name}.${d.methodName}: ${w}`) }

    return {
      route,
      base: d.classRef.name.replace(/Controller$/, ''),
      description: operation.description,
      baseShape: shape,
      bindings,
      guards: collectGuards(this.reflector, d.classRef, d.method),
      requestSlots: requestSlotFields(bindings),
      streaming: isAsyncGeneratorFn(d.method)
    }
  }

  /** Build a guard-application closure shared by both run shapes. */
  private guardRunner(d: Discovered, shared: Reflected, globalGuards: Type<CanActivate>[]) {
    const { moduleRef, reflector, appConfig } = this
    const { guards, requestSlots } = shared
    const { classRef, method } = d
    return async (context: SilkweaveContext, input: object): Promise<void> => {
      // Resolved at call time - `APP_GUARD` instances aren't populated until
      // `app.init()` finishes. Globals run before the route/class guards.
      const all = [...collectGlobalGuards(appConfig, globalGuards), ...guards]
      if (all.length === 0) { return }
      const request = context.getOptional<unknown>('request')
      const response = context.getOptional<unknown>('response') ?? null
      const hasRequest = request != null
      const guardRequest = hasRequest ? request : { headers: {}, params: {}, query: {} }
      populateRequestSlots(guardRequest, requestSlots, input as Record<string, unknown>)
      await runGuards(all, moduleRef, reflector, classRef, method, guardRequest, response, hasRequest ? 'http' : 'rpc')
    }
  }

  /** Synthesize the MCP-targeted action (unchanged behavior from v2.4). */
  private mcpAction(d: Discovered, shared: Reflected, globalGuards: Type<CanActivate>[], defaultResult?: 'json' | 'smart'): Action {
    const meta = d.mcp!
    const shape = { ...shared.baseShape, ...inputShape(meta.input) }
    const name = meta.name ?? `${shared.base}.${d.methodName}`
    const description = meta.description ?? shared.description ?? `${d.methodName} (${shared.route.method} /${shared.route.path})`
    const applyParamPipes = meta.pipes !== 'skip'
    const applyGuards = this.guardRunner(d, shared, globalGuards)
    const { method, instance } = d
    const { bindings, streaming } = shared

    // `result: 'structured'` turns the output schema into a hard MCP contract,
    // so it must be author-asserted: @Mcp({ output }) or an explicit
    // @Trpc({ output }) on the same method. Reflected @ApiOkResponse schemas
    // (one level deep, null-vs-optional gaps) are deliberately NOT accepted.
    const disposition = meta.result ?? defaultResult
    const output = resolveSchema(meta.output) ?? resolveSchema(d.trpc?.output)
    if (disposition === 'structured') {
      if (streaming) {
        throw new SilkweaveError(
          `${d.classRef.name}.${d.methodName}: @Mcp({ result: 'structured' }) is not supported on a streaming (async *) route - there is no single result to validate`,
          'invalid_action'
        )
      }
      if (!output) {
        throw new SilkweaveError(
          `${d.classRef.name}.${d.methodName}: @Mcp({ result: 'structured' }) requires an explicit output schema - set @Mcp({ output }) or @Trpc({ output }). Reflected @ApiOkResponse schemas are not accepted as structured contracts.`,
          'invalid_action'
        )
      }
    }

    return {
      name,
      description,
      input: z.object(shape),
      ...(disposition ? { disposition } : {}),
      ...(disposition === 'structured' && output ? { output } : {}),
      annotations: { ...verbAnnotations(shared.route.method), ...meta.annotations },
      isEnabled: (ctx) => ctx.getOptional<string>('adapter') === 'mcp',
      ...(streaming
        ? { chunk: z.unknown(), run: streamingRun(applyGuards, method, instance, bindings, applyParamPipes, false) }
        : {
          run: async (input: object, context: SilkweaveContext): Promise<object> => {
            await applyGuards(context, input)
            const request = context.getOptional<{ headers?: Record<string, unknown> }>('request')
            const response = context.getOptional<unknown>('response')
            const result = await invokeRebound(method, instance, input as Record<string, unknown>, bindings, request, response, applyParamPipes)
            return result ?? {}
          }
        })
    } as Action
  }

  /** Synthesize the tRPC-targeted action (kind/output/subscription + httpStatus errors). */
  private trpcAction(d: Discovered, shared: Reflected, globalGuards: Type<CanActivate>[]): Action {
    const meta = d.trpc!
    const shape = { ...shared.baseShape, ...inputShape(meta.input) }
    const name = meta.name ?? `${shared.base}.${d.methodName}`
    const description = meta.description ?? shared.description ?? `${d.methodName} (${shared.route.method} /${shared.route.path})`
    const applyParamPipes = meta.pipes !== 'skip'
    const applyGuards = this.guardRunner(d, shared, globalGuards)
    const { method, instance } = d
    const { bindings, streaming } = shared

    // tRPC and typegen both consume `@Trpc` actions; MCP never does.
    const isEnabled = (ctx: SilkweaveContext): boolean => {
      const adapter = ctx.getOptional<string>('adapter')
      return adapter === 'trpc' || adapter === 'typegen'
    }

    if (streaming) {
      return {
        name,
        description,
        input: z.object(shape),
        chunk: resolveSchema(meta.chunk) ?? z.unknown(),
        isEnabled,
        run: streamingRun(applyGuards, method, instance, bindings, applyParamPipes, true)
      } as Action
    }

    const kind: ActionKind = meta.kind === 'query' || meta.kind === 'mutation'
      ? meta.kind
      : (shared.route.method === 'GET' ? 'query' : 'mutation')
    const output = resolveOutput(meta, method)

    // Reflection is one level deep, so a nested DTO or `Dto[]` output property
    // degrades to `unknown`/`unknown[]`. Surface it - the fix is `@Trpc({ output })`.
    const degraded = outputDegradedFields(meta, method)
    if (output && degraded.length > 0) {
      logger.warn(
        `${d.classRef.name}.${d.methodName}: tRPC output field(s) ${degraded.join(', ')} reflected to 'unknown' ` +
        '(nested DTO or Dto[] - reflection is one level deep). Supply @Trpc({ output }) with a Zod schema for precise types.'
      )
    }

    return {
      name,
      description,
      input: z.object(shape),
      ...(output ? { output } : {}),
      kind,
      isEnabled,
      run: async (input: object, context: SilkweaveContext): Promise<object> => {
        try {
          await applyGuards(context, input)
          const request = context.getOptional<{ headers?: Record<string, unknown> }>('request')
          const response = context.getOptional<unknown>('response')
          const result = await invokeRebound(method, instance, input as Record<string, unknown>, bindings, request, response, applyParamPipes)
          return result ?? {}
        } catch (error) {
          throw toSilkweaveError(error)
        }
      }
    } as Action
  }
}

/**
 * Verb-derived MCP annotation defaults for a controller route. Explicit
 * `@Mcp({ annotations })` fields are merged over these by the caller.
 */
function verbAnnotations(method: string): ToolAnnotations {
  if (method === 'GET') { return { readOnlyHint: true, idempotentHint: true } }
  if (method === 'PUT') { return { readOnlyHint: false, idempotentHint: true } }
  if (method === 'DELETE') { return { readOnlyHint: false, destructiveHint: true, idempotentHint: true } }
  return { readOnlyHint: false }
}

/** Build a streaming (`async *`) run that applies guards then yields the method's chunks. */
function streamingRun(
  applyGuards: (context: SilkweaveContext, input: object) => Promise<void>,
  method: (...args: unknown[]) => unknown,
  instance: object,
  bindings: Binding[],
  applyParamPipes: boolean,
  mapErrors: boolean
) {
  return async function* (input: object, context: SilkweaveContext): AsyncGenerator<unknown, void, void> {
    try {
      await applyGuards(context, input)
      const request = context.getOptional<{ headers?: Record<string, unknown> }>('request')
      const response = context.getOptional<unknown>('response')
      const gen = await invokeRebound(method, instance, input as Record<string, unknown>, bindings, request, response, applyParamPipes) as AsyncIterable<unknown>
      for await (const chunk of gen) { yield chunk }
    } catch (error) {
      throw mapErrors ? toSilkweaveError(error) : error
    }
  }
}

/** Resolve a `@Trpc` action's output schema: explicit override wins over `@ApiOkResponse` reflection. */
function resolveOutput(meta: TrpcMetadata, method: (...args: unknown[]) => unknown): z.ZodType | undefined {
  return resolveSchema(meta.output) ?? reflectResponseSchema(method)
}

/**
 * Output field names that reflected to `unknown` (nested DTO / `Dto[]`). Only the
 * reflected paths are inspected - an explicit Zod or raw-shape `@Trpc({ output })`
 * is the caller's own typing and is never flagged.
 */
function outputDegradedFields(meta: TrpcMetadata, method: (...args: unknown[]) => unknown): string[] {
  if (meta.output != null && isZodSchema(meta.output)) { return [] }
  const fields = typeof meta.output === 'function'
    ? reflectDtoFields(meta.output)
    : meta.output != null ? undefined : reflectResponseFields(method)
  return fields ? unreflectedFields(fields) : []
}

/**
 * Normalise an `@Mcp`/`@Trpc({ input })` override to a raw Zod shape. Accepts a
 * plain `Record<string, ZodType>` or a whole `z.object({ ... })` (duck-typed by
 * `safeParse` + `shape`, so a different zod copy's object still unwraps).
 */
function inputShape(input: McpMetadata['input']): Record<string, z.ZodType> {
  if (!input) { return {} }
  const maybe = input as { safeParse?: unknown; shape?: unknown }
  if (typeof maybe.safeParse === 'function' && maybe.shape != null && typeof maybe.shape === 'object') {
    return maybe.shape as Record<string, z.ZodType>
  }
  return input as Record<string, z.ZodType>
}

/**
 * Coerce an `output`/`chunk` override to a Zod schema: a Zod schema passes
 * through, a DTO class is reflected, and a raw shape is wrapped in `z.object`.
 */
function resolveSchema(value: TrpcMetadata['output']): z.ZodType | undefined {
  if (value == null) { return undefined }
  if (isZodSchema(value)) { return value }
  if (typeof value === 'function') { return reflectDtoSchema(value) }
  return z.object(value)
}

function isZodSchema(value: unknown): value is z.ZodType {
  return Boolean(value) && typeof value === 'object' && typeof (value as { safeParse?: unknown }).safeParse === 'function'
}

function isAsyncGeneratorFn(fn: unknown): boolean {
  return typeof fn === 'function' && (fn as { constructor?: { name?: string } }).constructor?.name === 'AsyncGeneratorFunction'
}

/**
 * Convert a thrown Nest `HttpException` into a `SilkweaveError` carrying its HTTP
 * status, so the tRPC adapter's `mapError` maps it to the right `TRPCError` code
 * (and `data.httpStatus`) - e.g. a denying `AuthGuard`'s `UnauthorizedException`
 * surfaces to the client as a `401`. Non-HTTP errors pass through unchanged.
 */
function toSilkweaveError(error: unknown): unknown {
  if (error instanceof HttpException) {
    const status = error.getStatus()
    const response = error.getResponse()
    const raw = typeof response === 'string'
      ? response
      : (response as { message?: unknown })?.message ?? error.message
    const message = Array.isArray(raw) ? raw.join(', ') : String(raw)
    return new SilkweaveError(message, 'http_error', status)
  }
  return error
}

/** Build the merged Zod input shape and the per-argument re-bind plan. */
function buildInput(
  proto: object,
  methodName: string,
  pathParams: string[],
  slots: ReturnType<typeof readParamSlots>,
  operationParams: Record<string, FieldDesc>,
  docFields: Record<string, FieldDesc>
): BuiltInput {
  const designTypes = (Reflect.getMetadata('design:paramtypes', proto, methodName) as unknown[] | undefined) ?? []
  const fields: Record<string, FieldDesc> = {}
  const warnings: string[] = []
  const maxIndex = slots.reduce((m, s) => Math.max(m, s.index), -1)
  const bindings: Binding[] = Array.from({ length: maxIndex + 1 }, () => ({ kind: 'missing' as const }))

  const addField = (name: string, desc: FieldDesc): void => {
    fields[name] = name in fields ? mergeField(fields[name], desc) : desc
  }

  for (const slot of slots) {
    const { binding, fields: contributed } = contributeSlot(slot, pathParams, designTypes)
    bindings[slot.index] = binding
    for (const [name, desc] of Object.entries(contributed)) { addField(name, desc) }
    // A whole-DTO `@Body()`/`@Query()` that reflected to zero fields: the type
    // was unreflectable (an interface, or an intersection/union TypeScript
    // erases to `Object`/`Array` under `design:type`). Its fields are silently
    // absent unless declared via `@Mcp`/`@Trpc({ input })`.
    if (binding.kind === 'object' && binding.fields.length === 0) {
      const typeName = (designTypes[slot.index] as { name?: string } | undefined)?.name ?? 'unknown'
      warnings.push(
        `whole-${binding.source} parameter #${slot.index} (type '${typeName}') reflected no input fields. ` +
        `If it is an intersection/union (e.g. 'A & B'), TypeScript erases it to '${typeName}' so the DTO is lost - ` +
        'use a single DTO class or declare the fields via @Mcp/@Trpc({ input }).'
      )
    }
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

  return { shape, bindings, warnings }
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
