import type { FieldDesc } from './schema.js'
import { swaggerParamToField } from './schema.js'

/** `@nestjs/swagger` reflect-metadata keys (read directly - swagger is an optional peer). */
const API_OPERATION = 'swagger/apiOperation'
const API_PARAMETERS = 'swagger/apiParameters'

export interface OperationMeta {
  /** Tool-description candidate from `@ApiOperation({ summary | description })`. */
  description?: string
  /** Per-name `FieldDesc` reflected from `@ApiParam`/`@ApiQuery` entries. */
  params: Record<string, FieldDesc>
}

/**
 * Read operation-level `@nestjs/swagger` metadata off a controller method:
 * `@ApiOperation` (summary/description) and the `@ApiParam`/`@ApiQuery` array
 * (each describing one path/query field). Returns empty data when swagger
 * decorators are absent.
 */
export function reflectOperation(method: (...args: any[]) => any): OperationMeta {
  const operation = Reflect.getMetadata(API_OPERATION, method) as Record<string, any> | undefined
  const description = operation
    ? typeof operation['summary'] === 'string' && operation['summary']
      ? operation['summary']
      : typeof operation['description'] === 'string'
        ? operation['description']
        : undefined
    : undefined

  const parameters = (Reflect.getMetadata(API_PARAMETERS, method) as Array<Record<string, any>> | undefined) ?? []
  const params: Record<string, FieldDesc> = {}
  for (const p of parameters) {
    const name = typeof p['name'] === 'string' ? p['name'] : undefined
    if (!name) {
      continue
    }
    params[name] = swaggerParamToField(p)
  }

  return { description, params }
}
