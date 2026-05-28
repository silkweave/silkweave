import { ForbiddenException, type CanActivate, type Type } from '@nestjs/common'
import { GUARDS_METADATA } from '@nestjs/common/constants.js'
import { ModuleRef, Reflector } from '@nestjs/core'
import { isObservable, lastValueFrom } from 'rxjs'
import { SilkweaveExecutionContext } from './executionContext.js'

type GuardRef = Type<CanActivate> | CanActivate

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
 * Run the configured guards against an HTTP request. Throws `ForbiddenException`
 * if any guard rejects, mirroring Nest's HTTP request-pipeline behavior.
 *
 * Pass `null` for `response` when running on top of a tRPC or MCP request that
 * doesn't surface a raw response object; guards that introspect the response
 * will receive `null`.
 */
export async function runGuards(
  guards: GuardRef[],
  moduleRef: ModuleRef,
  reflector: Reflector,
  classRef: Type<unknown>,
  handler: (...args: unknown[]) => unknown,
  request: unknown,
  response: unknown
): Promise<void> {
  if (guards.length === 0) { return }
  const context = new SilkweaveExecutionContext([request, response], classRef, handler, 'http')
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
