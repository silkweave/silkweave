import type z from 'zod/v4'
import { type Action, type HttpMethod } from './action.js'
import { SilkweaveError } from './error.js'
import { unwrap } from './zod.js'

const PATH_PARAM_RE = /:([A-Za-z0-9_]+)/g

/**
 * Resolve the HTTP verb for an action. An explicit `method` always wins;
 * otherwise `kind: 'query'` maps to `GET` and everything else to `POST`.
 */
export function actionMethod(action: Pick<Action, 'method' | 'kind'>): HttpMethod {
  if (action.method) {
    return action.method
  }
  return action.kind === 'query' ? 'GET' : 'POST'
}

/** Whether a request with this method carries a body (everything except GET). */
export function methodHasBody(method: HttpMethod): boolean {
  return method !== 'GET'
}

/** Extract the `:param` placeholder names from a route path template. */
export function pathParamNames(path: string | undefined): string[] {
  if (!path) {
    return []
  }
  return [...path.matchAll(PATH_PARAM_RE)].map((match) => match[1])
}

/**
 * Assert that every `:param` in `action.path` and every `queryParams` entry is a
 * field of the input schema. Throws a `SilkweaveError` at registration time so
 * misconfigured routing fails fast instead of silently dropping values.
 */
export function validateActionRouting(action: Action): void {
  const shape = action.input.shape
  for (const param of pathParamNames(action.path)) {
    if (!(param in shape)) {
      throw new SilkweaveError(
        `Action "${action.name}" path "${action.path}" references ":${param}" but the input schema has no "${param}" field`,
        'invalid_action_routing'
      )
    }
  }
  for (const key of action.queryParams ?? []) {
    if (!(String(key) in shape)) {
      throw new SilkweaveError(
        `Action "${action.name}" lists query param "${String(key)}" but the input schema has no such field`,
        'invalid_action_routing'
      )
    }
  }
}

/**
 * Coerce a raw string (from the URL path or query string) to the primitive the
 * field's schema expects. Non-string values pass through untouched (REST
 * frameworks like Fastify may have already coerced via JSON Schema), and a
 * failed coercion returns the original value so Zod surfaces a proper error.
 */
function coerceScalar(field: z.ZodTypeAny | undefined, value: unknown): unknown {
  if (!field || typeof value !== 'string') {
    return value
  }
  const [base] = unwrap(field)
  const type = (base as { def?: { type?: string } }).def?.type
  if (type === 'number') {
    const num = Number(value)
    return value.trim() === '' || Number.isNaN(num) ? value : num
  }
  if (type === 'boolean') {
    if (value === 'true') {
      return true
    }
    if (value === 'false') {
      return false
    }
    return value
  }
  if (type === 'bigint') {
    try {
      return BigInt(value)
    } catch {
      return value
    }
  }
  return value
}

export interface ActionInputSources {
  /** Path parameters keyed by `:param` name (e.g. Express/Fastify `req.params`). */
  params?: Record<string, string | undefined>
  /** Parsed query string (string values, or arrays/coerced values from a framework). */
  query?: Record<string, unknown>
  /** Parsed request body (already-typed JSON for body methods). */
  body?: unknown
}

/**
 * Merge an action's path params, query params, and body into a single input
 * object honouring its `method`/`path`/`queryParams` routing config:
 *
 * - body fields form the base layer (only for body-carrying methods),
 * - declared query params override (on bodyless GET requests every input field
 *   that is not a path param is read from the query string),
 * - path params override last.
 *
 * String values from the path/query are coerced to the primitive their schema
 * expects. The result is not validated here - callers pass it to
 * `action.input.parse()` (or let a framework validate it).
 */
export function resolveActionInput(action: Action, sources: ActionInputSources): Record<string, unknown> {
  const shape = action.input.shape
  const method = actionMethod(action)
  const hasBody = methodHasBody(method)
  const params = sources.params ?? {}
  const query = sources.query ?? {}
  const pathParams = new Set(pathParamNames(action.path))
  const queryKeys = new Set((action.queryParams ?? []).map(String))

  const merged: Record<string, unknown> = {}

  if (hasBody && sources.body && typeof sources.body === 'object') {
    Object.assign(merged, sources.body as Record<string, unknown>)
  }

  for (const [key, raw] of Object.entries(query)) {
    if (raw === undefined) {
      continue
    }
    const declared = hasBody ? queryKeys.has(key) : key in shape && !pathParams.has(key)
    if (!declared) {
      continue
    }
    merged[key] = Array.isArray(raw) ? raw : coerceScalar(shape[key], raw)
  }

  for (const key of pathParams) {
    const raw = params[key]
    if (raw === undefined) {
      continue
    }
    merged[key] = coerceScalar(shape[key], raw)
  }

  return merged
}
