import { type Action, actionMethod, methodHasBody, pathParamNames } from '@silkweave/core'
import { camelCase } from 'change-case'
import { z } from 'zod/v4'

export interface ActionPathsOptions {
  /** URL prefix the `rest()` adapter mounts on. Default `'/api'`. */
  basePath?: string
  /** OpenAPI tag the actions are grouped under. Default `'Actions'`. */
  tag?: string
}

interface JsonSchemaObject {
  properties?: Record<string, unknown>
  required?: string[]
}

/** Convert a route template's `:param` placeholders to OpenAPI `{param}` form. */
function toOpenApiPath(template: string): string {
  return template.replace(/:([A-Za-z0-9_]+)/g, '{$1}')
}

/** The OpenAPI path key for an action - mirrors the `rest()` adapter's routing. */
function actionRoute(action: Action, basePath: string): string {
  const sub = action.path ? action.path.replace(/^\//, '') : action.name.replace(/\./g, '/')
  return toOpenApiPath(`${basePath}/${sub}`.replace(/\/{2,}/g, '/'))
}

/** `z.toJSONSchema` tags a top-level `$schema`; drop it for a tidy OpenAPI doc. */
function toJsonSchema(schema: z.ZodType): Record<string, unknown> {
  const { $schema: _schema, ...rest } = z.toJSONSchema(schema) as Record<string, unknown>
  return rest
}

function responseSchema(action: Action): unknown {
  if (action.output) { return toJsonSchema(action.output) }
  if (action.chunk) { return { type: 'array', items: toJsonSchema(action.chunk) } }
  return undefined
}

interface SourceSplit {
  parameters: Array<Record<string, unknown>>
  bodyProps: Record<string, unknown>
  bodyRequired: string[]
}

/** Split an action's input fields into OpenAPI path/query parameters and a body, matching the `rest()` adapter. */
function splitInputSources(action: Action, hasBody: boolean): SourceSplit {
  const json = z.toJSONSchema(action.input) as JsonSchemaObject
  const required = new Set(json.required ?? [])
  const pathParams = new Set(pathParamNames(action.path))
  const queryKeys = new Set((action.queryParams ?? []).map(String))

  const split: SourceSplit = { parameters: [], bodyProps: {}, bodyRequired: [] }
  for (const [key, schema] of Object.entries(json.properties ?? {})) {
    if (pathParams.has(key)) {
      split.parameters.push({ name: key, in: 'path', required: true, schema })
    } else if (!hasBody || queryKeys.has(key)) {
      split.parameters.push({ name: key, in: 'query', required: required.has(key), schema })
    } else {
      split.bodyProps[key] = schema
      if (required.has(key)) { split.bodyRequired.push(key) }
    }
  }
  return split
}

/** Build the OpenAPI operation object for a single action. */
function buildOperation(action: Action, tag: string): Record<string, unknown> {
  const hasBody = methodHasBody(actionMethod(action))
  const { parameters, bodyProps, bodyRequired } = splitInputSources(action, hasBody)
  const response = responseSchema(action)

  const operation: Record<string, unknown> = {
    tags: [tag],
    summary: action.description,
    operationId: camelCase(action.name),
    responses: {
      200: {
        description: 'Successful response',
        ...(response ? { content: { 'application/json': { schema: response } } } : {})
      }
    }
  }
  if (parameters.length) { operation.parameters = parameters }
  if (hasBody && Object.keys(bodyProps).length) {
    operation.requestBody = {
      required: bodyRequired.length > 0,
      content: { 'application/json': { schema: { type: 'object', properties: bodyProps, required: bodyRequired } } }
    }
  }
  return operation
}

/**
 * Build an OpenAPI `paths` fragment for a set of Silkweave actions, mirroring
 * exactly how the `rest()` adapter routes them: the same HTTP verb (`method` ??
 * `kind`), the same `path`/`name`-derived route, and the same path/query/body
 * field split (`pathParamNames` + `queryParams`). Schemas are inlined from the
 * Zod input/output via `z.toJSONSchema`; no shared components are emitted.
 */
export function buildActionPaths(
  actions: Action[],
  options: ActionPathsOptions = {}
): Record<string, Record<string, unknown>> {
  const basePath = (options.basePath ?? '/api').replace(/\/$/, '')
  const tag = options.tag ?? 'Actions'
  const paths: Record<string, Record<string, unknown>> = {}

  for (const action of actions) {
    const method = actionMethod(action).toLowerCase()
    const route = actionRoute(action, basePath)
    paths[route] = { ...(paths[route] ?? {}), [method]: buildOperation(action, tag) }
  }

  return paths
}
