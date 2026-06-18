/* eslint-disable @typescript-eslint/no-explicit-any */
import { z } from 'zod/v4'
import { fieldToZod, reflectDtoFields } from './schema.js'

/** `@nestjs/swagger` response metadata key (read directly - swagger is an optional peer). */
const API_RESPONSE = 'swagger/apiResponse'

/** Status keys we treat as the "success" response, in preference order. */
const SUCCESS_KEYS = ['200', '201', '202', '204', '2XX', 'default']

/**
 * Reflect a `@Trpc` procedure's output schema from the method's
 * `@ApiOkResponse({ type: Dto })` (or any 2xx `@ApiResponse`) metadata. The
 * response DTO is flattened with {@link reflectDtoFields} into a Zod object,
 * wrapped in `z.array(...)` when the response is `isArray`.
 *
 * Returns `undefined` when there is no response DTO to reflect (e.g. a primitive
 * return type or no `@ApiResponse` decorator) - the caller then falls back to an
 * explicit `@Trpc({ output })` or an `unknown` output type.
 */
export function reflectResponseSchema(method: (...args: any[]) => any): z.ZodType | undefined {
  const responses = Reflect.getMetadata(API_RESPONSE, method) as Record<string, { type?: unknown; isArray?: boolean }> | undefined
  if (!responses) { return undefined }

  const key = SUCCESS_KEYS.find((k) => responses[k]) ?? Object.keys(responses)[0]
  const entry = key ? responses[key] : undefined
  const dtoType = entry?.type
  if (typeof dtoType !== 'function') { return undefined }

  const schema = reflectDtoSchema(dtoType)
  if (!schema) { return undefined }
  return entry?.isArray ? z.array(schema) : schema
}

/**
 * Reflect a DTO class (its `@ApiProperty`/`class-validator`-decorated properties)
 * into a Zod object schema. Returns `undefined` when the type isn't a class or
 * has no reflectable properties. Used for `@Trpc({ output })`/`@Trpc({ chunk })`
 * when given a DTO class instead of a Zod schema.
 */
export function reflectDtoSchema(dtoType: unknown): z.ZodType | undefined {
  if (typeof dtoType !== 'function') { return undefined }
  const fields = reflectDtoFields(dtoType)
  const names = Object.keys(fields)
  if (names.length === 0) { return undefined }
  const shape: Record<string, z.ZodType> = {}
  for (const name of names) { shape[name] = fieldToZod(fields[name]) }
  return z.object(shape)
}
