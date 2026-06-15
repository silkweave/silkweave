/* eslint-disable @typescript-eslint/no-explicit-any */
import { ROUTE_ARGS_METADATA } from '@nestjs/common/constants.js'

/**
 * `RouteParamtypes` numeric values from `@nestjs/common` (re-declared to avoid a
 * value import of an internal enum). These are how `@Param`/`@Query`/`@Body`/...
 * tag each handler argument in `ROUTE_ARGS_METADATA`.
 */
export const PARAMTYPE = {
  REQUEST: 0,
  RESPONSE: 1,
  NEXT: 2,
  BODY: 3,
  QUERY: 4,
  PARAM: 5,
  HEADERS: 6,
  SESSION: 7,
  FILE: 8,
  FILES: 9,
  HOST: 10,
  IP: 11,
  RAW_BODY: 12
} as const

export interface ParamSlot {
  /** `PARAMTYPE` value - which decorator tagged this argument. */
  paramtype: number
  /** Handler argument position. */
  index: number
  /** Decorator sub-key: `@Param('id')` → `'id'`; a bare `@Body()` → `undefined`. */
  data?: string
  /** Parameter-bound pipes (`@Param('id', ParseIntPipe)`). */
  pipes: unknown[]
  /** TypeScript-emitted constructor at this position (e.g. `String`, `CreateDto`). */
  designType?: unknown
}

/**
 * Read and normalise the route-argument metadata for a controller method.
 * Returns one {@link ParamSlot} per decorated handler argument, sorted by
 * argument index.
 */
export function readParamSlots(classRef: any, methodName: string, proto: any): ParamSlot[] {
  const raw = Reflect.getMetadata(ROUTE_ARGS_METADATA, classRef, methodName) as
    Record<string, { index: number; data?: unknown; pipes?: unknown[] }> | undefined
  if (!raw) { return [] }
  const designTypes = (Reflect.getMetadata('design:paramtypes', proto, methodName) as unknown[] | undefined) ?? []

  const slots: ParamSlot[] = []
  for (const key of Object.keys(raw)) {
    const entry = raw[key]
    const paramtype = Number(key.split(':')[0])
    if (Number.isNaN(paramtype)) { continue }
    slots.push({
      paramtype,
      index: entry.index,
      data: typeof entry.data === 'string' ? entry.data : undefined,
      pipes: entry.pipes ?? [],
      designType: designTypes[entry.index]
    })
  }
  return slots.sort((a, b) => a.index - b.index)
}
