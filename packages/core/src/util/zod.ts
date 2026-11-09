import { z } from 'zod/v4'
import { SilkweaveError } from './error.js'

export interface UnwrapResult {
  defaultValue?: any
  isOptional?: boolean
  isNullable?: boolean
  isReadOnly?: boolean
}

export function unwrap(type: z.ZodTypeAny, result: UnwrapResult = {}): [z.ZodTypeAny, UnwrapResult] {
  if (type instanceof z.ZodOptional) {
    result.isOptional = true
    return unwrap(type.unwrap() as z.ZodTypeAny, result)
  } else if (type instanceof z.ZodNullable) {
    result.isNullable = true
    return unwrap(type.unwrap() as z.ZodTypeAny, result)
  } else if (type instanceof z.ZodReadonly) {
    result.isReadOnly = true
    return unwrap(type.def.innerType as z.ZodTypeAny, result)
  } else if (type instanceof z.ZodDefault) {
    result.defaultValue = typeof type.def.defaultValue === 'function' ? type.def.defaultValue() : type.def.defaultValue
    return unwrap(type.unwrap() as z.ZodTypeAny, result)
  } else {
    return [type, result]
  }
}

/**
 * `true` for a classic zod v3 schema (`import { z } from 'zod'` on zod 3.x, or
 * `zod/v3` on zod 4): it carries `_def` but none of the v4 `_zod` internals.
 */
export function isClassicZodSchema(value: unknown): boolean {
  return typeof value === 'object' && value !== null && '_def' in value && !('_zod' in value)
}

/**
 * Reject classic zod v3 schemas on an action with a legible error. Silkweave
 * actions are written against the zod v4 API - `import { z } from 'zod/v4'`,
 * available from zod 3.25 (and the package root on zod 4) - which every adapter
 * relies on (JSON Schema, CLI options, typegen, MCP). A classic schema would
 * otherwise fail deep inside an adapter with an opaque internal error.
 */
export function assertZodV4Schemas(action: { name: string; input?: unknown; output?: unknown; chunk?: unknown }) {
  for (const field of ['input', 'output', 'chunk'] as const) {
    if (isClassicZodSchema(action[field])) {
      throw new SilkweaveError(
        `Action '${action.name}' ${field} is a classic zod v3 schema. Silkweave actions use the zod v4 API: import { z } from 'zod/v4' (zod >= 3.25) or from 'zod' (zod 4).`,
        'unsupported_schema'
      )
    }
  }
}
