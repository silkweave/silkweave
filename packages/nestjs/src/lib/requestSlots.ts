import type { Binding } from './rebind.js'

/**
 * Request-slot reconstruction: route the validated tool input back into the
 * `request.params`/`query`/`body` slots Express would populate over REST, so a
 * host guard reading any of them decides identically over MCP and REST. Kept in
 * its own module (not re-exported from the package root) so these helpers stay
 * internal while remaining unit-testable.
 */

/** Input field names grouped by the REST request slot Express would source them from. */
export interface RequestSlots {
  /** `@Param`/path-template fields -> `request.params` (raw strings). */
  params: string[]
  /** `@Query` fields -> `request.query` (raw strings). */
  query: string[]
  /** `@Body` fields -> `request.body` (parsed values). */
  body: string[]
}

/**
 * Classify every input field by the REST request slot it would occupy, reading
 * the discovery-time {@link Binding}s. A whole-DTO `@Query()`/`@Body()` (`object`
 * binding) contributes all its fields to the matching slot; a bare `@Param()`
 * (`params` binding) and a path-sourced `value` go to `params`.
 */
export function requestSlotFields(bindings: Binding[]): RequestSlots {
  const slots: RequestSlots = { params: [], query: [], body: [] }
  for (const b of bindings) {
    if (b.kind === 'params') {
      slots.params.push(...b.fields)
    } else if (b.kind === 'object') {
      slots[b.source].push(...b.fields)
    } else if (b.kind === 'value') {
      slots[b.source === 'path' ? 'params' : b.source].push(b.field)
    }
  }
  return slots
}

/** Fill one request slot from the validated input, only adding absent keys. */
function fillSlot(
  bag: Record<string, unknown>,
  fields: string[],
  input: Record<string, unknown>,
  stringify: boolean
): void {
  for (const field of fields) {
    if (!(field in bag) && input[field] !== undefined) {
      bag[field] = stringify ? String(input[field]) : input[field]
    }
  }
}

/**
 * Fill `request.params`/`query`/`body` from the validated input, mirroring the
 * slots Express would populate over REST (path -> `params`, `@Query` -> `query`,
 * `@Body` -> `body`). Path/query values are stringified to match how Express
 * delivers them (a guard reading `req.query.limit` sees `'10'`, not `10`); body
 * keeps the parsed values. Only absent keys are added, so a real REST/tRPC
 * request's own params/query/body are never overwritten. This is what lets a
 * scope-enforcing guard (`req.params.sessionId`, `req.body.sessionId`, ...)
 * decide identically over MCP and REST.
 */
export function populateRequestSlots(request: unknown, slots: RequestSlots, input: Record<string, unknown>): void {
  if (typeof request !== 'object' || request === null) {
    return
  }
  const req = request as {
    params?: Record<string, unknown>
    query?: Record<string, unknown>
    body?: Record<string, unknown>
  }
  if (slots.params.length > 0) {
    fillSlot((req.params ??= {}), slots.params, input, true)
  }
  if (slots.query.length > 0) {
    fillSlot((req.query ??= {}), slots.query, input, true)
  }
  if (slots.body.length > 0) {
    fillSlot((req.body ??= {}), slots.body, input, false)
  }
}
