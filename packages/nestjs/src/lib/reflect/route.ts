import { PATH_METADATA, METHOD_METADATA } from '@nestjs/common/constants.js'

/**
 * `RequestMethod` numeric values (from `@nestjs/common`) mapped to verbs. We
 * map our own table rather than importing the enum to avoid pulling a value
 * import for a handful of constants.
 */
const REQUEST_METHOD: Record<number, string> = {
  0: 'GET',
  1: 'POST',
  2: 'PUT',
  3: 'DELETE',
  4: 'PATCH',
  6: 'OPTIONS',
  7: 'HEAD'
}

export interface RouteInfo {
  /** HTTP verb (`GET`/`POST`/...). `PATCH` and others outside the REST set fall back to `POST`-ish handling by callers. */
  method: string
  /** Full route template in Nest form, e.g. `sessions/:sessionId/channels/:channelId` (no leading slash). */
  path: string
  /** Full route template in OpenAPI form, e.g. `/sessions/{sessionId}/channels/{channelId}`. */
  openapiPath: string
  /** Names of the `:param` placeholders across controller + method path. */
  pathParams: string[]
}

function normalizeSegment(value: unknown): string {
  if (typeof value !== 'string') {
    return ''
  }
  return value.replace(/^\/+/, '').replace(/\/+$/, '')
}

function joinPath(...segments: string[]): string {
  return segments.map(normalizeSegment).filter(Boolean).join('/')
}

/**
 * Resolve the composed route (controller prefix + method path), HTTP verb, and
 * path-param names for a decorated controller method, reading Nest's own
 * `PATH_METADATA`/`METHOD_METADATA` reflection.
 */
export function reflectRoute(classRef: any, method: (...args: any[]) => any): RouteInfo {
  const classPath = Reflect.getMetadata(PATH_METADATA, classRef) as string | string[] | undefined
  const methodPath = Reflect.getMetadata(PATH_METADATA, method) as string | string[] | undefined
  const verbCode = Reflect.getMetadata(METHOD_METADATA, method) as number | undefined

  const classSeg = Array.isArray(classPath) ? (classPath[0] ?? '') : (classPath ?? '')
  const methodSeg = Array.isArray(methodPath) ? (methodPath[0] ?? '') : (methodPath ?? '')
  const path = joinPath(classSeg, methodSeg)
  const httpMethod = REQUEST_METHOD[verbCode ?? 0] ?? 'GET'

  const pathParams = [...path.matchAll(/:([A-Za-z0-9_]+)/g)].map((m) => m[1])
  const openapiPath = `/${path.replace(/:([A-Za-z0-9_]+)/g, '{$1}')}`

  return { method: httpMethod, path, openapiPath, pathParams }
}
