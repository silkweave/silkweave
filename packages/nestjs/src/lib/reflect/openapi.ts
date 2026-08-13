import { type FieldDesc, mergeField, openapiSchemaToField } from './schema.js'

/**
 * A minimal view of an OpenAPI document - the subset we read. Matches the shape
 * `SwaggerModule.createDocument()` returns, but typed loosely so callers can
 * pass any compatible object without a hard `@nestjs/swagger` dependency.
 */
export interface OpenApiDocument {
  paths?: Record<string, Record<string, any>>
  components?: { schemas?: Record<string, any> }
}

export interface OpenApiLookup {
  doc: OpenApiDocument
  /** `${METHOD} ${path}` → operation object. */
  operations: Map<string, any>
}

/** Index a document's operations by `${METHOD} ${path}` for fast matching. */
export function buildOpenApiLookup(doc: OpenApiDocument): OpenApiLookup {
  const operations = new Map<string, any>()
  for (const [path, item] of Object.entries(doc.paths ?? {})) {
    for (const [verb, op] of Object.entries(item ?? {})) {
      operations.set(`${verb.toUpperCase()} ${path}`, op)
    }
  }
  return { doc, operations }
}

/** Locate the operation for a route, tolerating a global path prefix on the document side. */
function findOperation(lookup: OpenApiLookup, method: string, openapiPath: string): any | undefined {
  const exact = lookup.operations.get(`${method} ${openapiPath}`)
  if (exact) {
    return exact
  }
  // Fall back to a suffix match so a `setGlobalPrefix('api')` document still resolves.
  for (const [key, op] of lookup.operations) {
    const [verb, path] = key.split(' ')
    if (verb === method && (path.endsWith(openapiPath) || openapiPath.endsWith(path))) {
      return op
    }
  }
  return undefined
}

function resolveRef(doc: OpenApiDocument, schema: any): any {
  let current = schema
  let guard = 0
  while (current && typeof current === 'object' && typeof current['$ref'] === 'string' && guard < 10) {
    const match = /^#\/components\/schemas\/(.+)$/.exec(current['$ref'])
    if (!match) {
      break
    }
    current = doc.components?.schemas?.[match[1]]
    guard += 1
  }
  return current
}

/**
 * Resolve the per-field descriptors for a route from an ingested OpenAPI
 * document. Merges `parameters` (path/query/header) and the JSON request-body
 * schema's properties into a single field map. Returns `{}` when the operation
 * isn't found - callers fall back to decorator reflection.
 */
export function openApiFields(lookup: OpenApiLookup, method: string, openapiPath: string): Record<string, FieldDesc> {
  const op = findOperation(lookup, method, openapiPath)
  if (!op) {
    return {}
  }
  const out: Record<string, FieldDesc> = {}

  for (const param of (op['parameters'] as Array<Record<string, any>> | undefined) ?? []) {
    const name = typeof param['name'] === 'string' ? param['name'] : undefined
    if (!name) {
      continue
    }
    const schema = param['schema'] ? resolveRef(lookup.doc, param['schema']) : undefined
    let field = schema ? openapiSchemaToField(schema) : {}
    if (param['description']) {
      field = mergeField(field, { description: param['description'] })
    }
    if (typeof param['required'] === 'boolean') {
      field = mergeField(field, { required: param['required'] })
    }
    out[name] = field
  }

  const bodySchema = resolveRef(lookup.doc, op['requestBody']?.['content']?.['application/json']?.['schema'])
  if (bodySchema && typeof bodySchema === 'object' && bodySchema['properties']) {
    const required = new Set<string>(Array.isArray(bodySchema['required']) ? bodySchema['required'] : [])
    for (const [name, propSchema] of Object.entries(bodySchema['properties'] as Record<string, any>)) {
      const field = openapiSchemaToField(resolveRef(lookup.doc, propSchema))
      field.required = required.has(name)
      out[name] = field
    }
  }

  return out
}
