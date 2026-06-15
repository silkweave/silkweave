/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment */
import { createRequire } from 'node:module'
import { join } from 'node:path'

let cached: any | null | undefined

/**
 * Lazily resolve the optional `class-validator` peer; `null` when not installed.
 * Resolution is attempted both from this package and from the app's working
 * directory - the latter is what finds it in a pnpm install where the optional
 * peer lives in the consumer app rather than alongside `@silkweave/nestjs`. A
 * pnpm-deduped install shares one physical copy, so the metadata singleton the
 * app's decorators wrote to is the same one we read.
 */
function loadClassValidator(): any | null {
  if (cached !== undefined) { return cached }
  for (const base of [import.meta.url, join(process.cwd(), 'noop.js')]) {
    try {
      cached = createRequire(base)('class-validator')
      return cached
    } catch { /* try the next resolution base */ }
  }
  cached = null
  return cached
}

export interface ValidationMeta {
  /** `ValidationTypes` discriminator (e.g. `customValidation`, `conditionalValidation`). */
  type?: string
  /** Validator name - the actionable identity for built-ins (`isString`, `minLength`, ...). */
  name?: string
  constraints?: unknown[]
}

/**
 * Read `class-validator` metadata for a DTO class, grouped by property name.
 * Returns an empty map when `class-validator` is not installed or the class
 * carries no validation decorators - so callers degrade gracefully to swagger /
 * `design:type` reflection.
 */
export function classValidatorMetas(dtoType: any): Record<string, ValidationMeta[]> {
  const cv = loadClassValidator()
  if (!cv?.getMetadataStorage) { return {} }
  let metas: Array<{ propertyName?: string; type?: string; name?: string; constraints?: unknown[] }>
  try {
    metas = cv.getMetadataStorage().getTargetValidationMetadatas(dtoType, null, false, false)
  } catch {
    return {}
  }
  const out: Record<string, ValidationMeta[]> = {}
  for (const m of metas) {
    if (!m.propertyName) { continue }
    (out[m.propertyName] ??= []).push({ type: m.type, name: m.name, constraints: m.constraints })
  }
  return out
}
