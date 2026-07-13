import { ForbiddenException, Logger, type CanActivate, type Type } from '@nestjs/common'
import { GUARDS_METADATA } from '@nestjs/common/constants.js'
import { ApplicationConfig, ModuleRef, Reflector } from '@nestjs/core'
import { isObservable, lastValueFrom } from 'rxjs'
import { SilkweaveExecutionContext } from './executionContext.js'

type GuardRef = Type<CanActivate> | CanActivate

/**
 * Collect the app's global guards that match an opt-in allow-list of classes.
 *
 * Reads both registration styles Nest exposes via `ApplicationConfig`:
 * `useGlobalGuards(new X())` instances (`getGlobalGuards()`) and
 * `{ provide: APP_GUARD, useClass }` DI guards (`getGlobalRequestGuards()`,
 * which yields `InstanceWrapper`s - we read `.instance` off each).
 *
 * The allow-list is intentionally explicit-by-class: a blanket "run every
 * global" would also fire unrelated globals (e.g. a `ThrottlerGuard` that
 * assumes a writable response) on every tool call. An empty allow-list runs
 * no globals, preserving the prior behavior.
 *
 * Call this at tool-call time, not at discovery time: `APP_GUARD` instances
 * aren't populated until `app.init()` finishes.
 */
export function collectGlobalGuards(
  appConfig: ApplicationConfig,
  allowList: Type<CanActivate>[]
): CanActivate[] {
  if (allowList.length === 0) { return [] }
  const requestWrappers = appConfig.getGlobalRequestGuards()
  // A request-scoped APP_GUARD has no static `.instance` (it's resolved per
  // request against a context id we don't have here), so it would be silently
  // dropped below - meaning an allow-listed guard the developer opted in to
  // never runs over MCP/tRPC (a potential auth bypass). Surface it loudly.
  for (const wrapper of requestWrappers) {
    const metatype = (wrapper as { metatype?: Type<CanActivate> }).metatype
    if (wrapper.instance == null && metatype && allowList.some((c) => c === metatype)) {
      new Logger('Silkweave').warn(
        `Global guard ${metatype.name} is request-scoped and cannot be enforced over MCP/tRPC - tool calls will NOT be guarded by it. Make it singleton-scoped (the default) to enforce it.`
      )
    }
  }
  const globals: CanActivate[] = [
    ...appConfig.getGlobalGuards(),
    ...requestWrappers.map((w) => w.instance)
  ].filter((g): g is CanActivate => g != null)
  return globals.filter((g) => allowList.some((c) => g instanceof c))
}

/**
 * Read `@UseGuards(...)` metadata for both the method and its class and merge
 * the two lists. Method-level guards run AFTER class-level guards (matching
 * Nest's own behavior).
 */
export function collectGuards(
  reflector: Reflector,
  classRef: Type<unknown>,
  handler: (...args: unknown[]) => unknown
): GuardRef[] {
  const classGuards = reflector.get<GuardRef[]>(GUARDS_METADATA, classRef) ?? []
  const methodGuards = reflector.get<GuardRef[]>(GUARDS_METADATA, handler) ?? []
  return [...classGuards, ...methodGuards]
}

async function resolveGuard(ref: GuardRef, moduleRef: ModuleRef): Promise<CanActivate> {
  if (typeof ref === 'function') {
    try {
      return await moduleRef.get(ref, { strict: false })
    } catch {
      return moduleRef.create(ref)
    }
  }
  return ref
}

/**
 * Run the configured guards against a request. Throws `ForbiddenException`
 * if any guard rejects, mirroring Nest's HTTP request-pipeline behavior.
 *
 * Pass `null` for `response` when running on top of a tRPC or MCP request that
 * doesn't surface a raw response object; guards that introspect the response
 * will receive `null`.
 *
 * `contextType` is reflected through `ExecutionContext.getType()` so guards can
 * branch on the transport. It is `'http'` for REST/tRPC and for MCP-over-HTTP
 * (where a header-bearing request stand-in is available); transports without any
 * HTTP request (e.g. MCP stdio) pass `'rpc'`.
 */
export async function runGuards(
  guards: GuardRef[],
  moduleRef: ModuleRef,
  reflector: Reflector,
  classRef: Type<unknown>,
  handler: (...args: unknown[]) => unknown,
  request: unknown,
  response: unknown,
  contextType: 'http' | 'rpc' = 'http'
): Promise<void> {
  if (guards.length === 0) { return }
  const context = new SilkweaveExecutionContext([request, response], classRef, handler, contextType)
  for (const ref of guards) {
    const guard = await resolveGuard(ref, moduleRef)
    const result = guard.canActivate(context)
    const allowed = isObservable(result) ? await lastValueFrom(result) : await Promise.resolve(result)
    if (!allowed) {
      throw new ForbiddenException('Forbidden resource')
    }
  }
  // Reflector kept in the signature for future use (e.g., per-guard metadata) - unused here.
  void reflector
}
