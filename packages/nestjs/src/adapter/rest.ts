import { HttpException } from '@nestjs/common'
import type { HttpAdapterHost } from '@nestjs/core'
import { AuthConfig, AuthInfo, validateToken } from '@silkweave/auth'
import { type Action, type Adapter, type AdapterGenerator, type SilkweaveContext, SilkweaveError } from '@silkweave/core'
import { buildLogLevels, type Logger, type LogLevel } from '@silkweave/logger'
import type { IncomingMessage, ServerResponse } from 'http'
import { z } from 'zod/v4'
import { reserveSlot, type NodeMiddleware } from '../lib/slot.js'
import type { NestSilkweaveAdapter } from '../lib/types.js'

const CONSOLE_LEVEL_MAP: Record<LogLevel, 'log' | 'info' | 'warn' | 'error'> = {
  emergency: 'error',
  alert: 'error',
  critical: 'error',
  error: 'error',
  warning: 'warn',
  notice: 'info',
  info: 'info',
  debug: 'log'
}

export interface RestAdapterOptions {
  /** URL prefix at which the REST routes are mounted. e.g. `'/api'` → `POST /api/users/list`. Default: `'/'`. */
  basePath?: string
  /** Optional bearer-token auth applied to every REST action. */
  auth?: AuthConfig
}

function createRestLogger(): Logger {
  return {
    ...buildLogLevels((level, data) => {
      console[CONSOLE_LEVEL_MAP[level]](data)
    }),
    progress: () => { /* progress notifications not supported on REST */ }
  }
}

interface RequestLike {
  headers: Record<string, string | string[] | undefined>
  body?: unknown
  query?: unknown
  url?: string
  method?: string
}

function actionNameToPath(name: string): string {
  return `/${name.replace(/\./g, '/')}`
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => chunks.push(c))
    req.on('end', () => {
      if (chunks.length === 0) { return resolve({}) }
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf-8'))) } catch (err) { reject(err) }
    })
    req.on('error', reject)
  })
}

function parseQuery(url: string | undefined): Record<string, string> {
  if (!url) { return {} }
  const qIndex = url.indexOf('?')
  if (qIndex === -1) { return {} }
  const params: Record<string, string> = {}
  const search = new URLSearchParams(url.slice(qIndex + 1))
  for (const [k, v] of search.entries()) { params[k] = v }
  return params
}

function sendJson(res: ServerResponse, body: unknown, status: number): void {
  if (res.headersSent) { return }
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify(body))
}

function handleRestError(err: unknown, res: ServerResponse): void {
  if (err instanceof z.ZodError) {
    sendJson(res, { error: 'validation_error', issues: err.issues }, 400)
    return
  }
  if (err instanceof SilkweaveError) {
    sendJson(res, { error: err.code, message: err.message }, err.statusCode)
    return
  }
  if (err instanceof HttpException) {
    const body = err.getResponse()
    const payload = typeof body === 'string' ? { error: err.name, message: body } : body
    sendJson(res, payload, err.getStatus())
    return
  }
  console.error(err)
  sendJson(res, { error: 'internal', message: 'Internal error' }, 500)
}

function buildHandler(actions: Action[], context: SilkweaveContext, auth: AuthConfig | undefined): NodeMiddleware {
  const routes = new Map<string, Action>()
  for (const action of actions) {
    const method = action.kind === 'query' ? 'GET' : 'POST'
    routes.set(`${method} ${actionNameToPath(action.name)}`, action)
  }
  const logger = createRestLogger()
  return async (req, res, next) => {
    const pathOnly = (req.url ?? '/').split('?')[0]
    const key = `${req.method ?? ''} ${pathOnly}`
    const action = routes.get(key)
    if (!action) {
      if (next) { return next() }
      sendJson(res, { error: 'not_found', message: `No route for ${req.method} ${pathOnly}` }, 404)
      return
    }
    try {
      const reqLike = req as unknown as RequestLike
      let authInfo: AuthInfo | undefined
      if (auth) {
        const authHeader = typeof reqLike.headers.authorization === 'string' ? reqLike.headers.authorization : undefined
        const result = await validateToken(authHeader, auth, context.fork({ request: req }))
        if (result.error) {
          for (const [k, v] of Object.entries(result.error.headers)) {
            res.setHeader(k, v)
          }
          sendJson(res, result.error.body, result.error.statusCode)
          return
        }
        authInfo = result.auth
      }
      const raw = action.kind === 'query'
        ? (reqLike.query ?? parseQuery(req.url))
        : (reqLike.body ?? await readJsonBody(req))
      const input = action.input.parse(raw) as object
      const result = await action.run(input, context.fork({
        logger,
        request: req,
        response: res,
        ...(authInfo ? { auth: authInfo } : {})
      }))
      sendJson(res, result, 200)
    } catch (err) {
      handleRestError(err, res)
    }
  }
}

/**
 * REST adapter for `@silkweave/nestjs`. Mounts each discovered `@Action` as a
 * route on Nest's running HTTP server:
 *
 * - `kind: 'query'` → `GET ${basePath}/${actionName-with-slashes}` (input read from query string)
 * - `kind: 'mutation'` → `POST ${basePath}/${actionName-with-slashes}` (input read from JSON body)
 *
 * Works on `@nestjs/platform-express` out of the box. For
 * `@nestjs/platform-fastify`, register `@fastify/express` before this adapter
 * so Nest can serve Express-style middleware.
 */
export function rest(options: RestAdapterOptions = {}): NestSilkweaveAdapter {
  return {
    name: 'rest',
    install: (host: HttpAdapterHost): AdapterGenerator => {
      const httpAdapter = host.httpAdapter
      if (!httpAdapter) {
        throw new Error('@silkweave/nestjs rest(): HttpAdapterHost.httpAdapter is not available.')
      }
      const basePath = (options.basePath ?? '').replace(/\/$/, '') || '/'
      const setHandler = reserveSlot(httpAdapter as unknown as { use: (path: string, h: NodeMiddleware) => unknown }, basePath, 'REST')
      return (_silkweaveOptions, baseContext): Adapter => {
        const context = baseContext.fork({ adapter: 'rest' })
        return {
          context,
          start: async (actions) => {
            setHandler(buildHandler(actions, context, options.auth))
          },
          stop: async () => { /* Nest owns the HTTP server */ }
        }
      }
    }
  }
}
