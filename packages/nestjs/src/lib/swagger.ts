import { type INestApplication } from '@nestjs/common'
import type { OpenAPIObject } from '@nestjs/swagger'
import { type Action, createContext } from '@silkweave/core'
import { ActionDiscovery } from './discovery.js'
import { buildActionPaths } from './openapi.js'
import { SILKWEAVE_MODULE_OPTIONS, type SilkweaveModuleOptions } from './types.js'

export interface SilkweaveSwaggerOptions {
  /**
   * URL prefix the `rest()` adapter mounts on. Defaults to the configured
   * `rest()` adapter's `basePath`, falling back to `'/api'`.
   */
  basePath?: string
  /** OpenAPI tag the actions are grouped under. Default `'Actions'`. */
  tag?: string
  /**
   * Include actions that are *not* enabled on the REST transport (gated out via
   * `transports` / `isEnabled`). Default `false` - the document mirrors the
   * routes the `rest()` adapter actually registers.
   */
  includeDisabled?: boolean
}

/**
 * Merge every REST-exposed Silkweave `@Action` into a NestJS Swagger
 * `OpenAPIObject`.
 *
 * `@nestjs/swagger` builds its document by scanning **controllers**, but
 * Silkweave registers action routes directly on the HTTP adapter (so they sit
 * ahead of controllers in the request pipeline) - which means the scanner never
 * sees them. This helper closes that gap: it discovers the actions through the
 * same `ActionDiscovery` provider the `rest()` adapter uses, builds OpenAPI
 * paths with the same routing logic (`buildActionPaths`), and merges them into
 * the document. The result stays in sync with the live routes without any
 * dynamic controllers.
 *
 * Call it between `SwaggerModule.createDocument()` and `SwaggerModule.setup()`:
 *
 * @example
 * ```ts
 * const document = SwaggerModule.createDocument(app, config)
 * addSilkweaveActions(app, document)
 * SwaggerModule.setup('api/docs', app, document)
 * ```
 */
export function addSilkweaveActions(
  app: INestApplication,
  document: OpenAPIObject,
  options: SilkweaveSwaggerOptions = {}
): OpenAPIObject {
  const discovery = app.get(ActionDiscovery)
  const moduleOptions = app.get<SilkweaveModuleOptions>(SILKWEAVE_MODULE_OPTIONS)
  const restAdapter = moduleOptions.adapters.find((adapter) => adapter.name === 'rest')
  const basePath = options.basePath ?? restAdapter?.basePath ?? '/api'

  const allActions = discovery.discover()
  const actions = options.includeDisabled
    ? allActions
    : allActions.filter((action) => isRestEnabled(action, moduleOptions))

  const paths = buildActionPaths(actions, { basePath, tag: options.tag })

  document.paths ??= {}
  for (const [route, item] of Object.entries(paths)) {
    document.paths[route] = { ...(document.paths[route] ?? {}), ...item }
  }
  return document
}

/** Whether an action would be registered by the `rest()` adapter (adapter: 'rest'). */
function isRestEnabled(action: Action, moduleOptions: SilkweaveModuleOptions): boolean {
  if (!action.isEnabled) { return true }
  return action.isEnabled(createContext({ ...(moduleOptions.context ?? {}), adapter: 'rest' }))
}
