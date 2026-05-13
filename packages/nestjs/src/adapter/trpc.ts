import type { HttpAdapterHost } from '@nestjs/core'
import { AuthConfig } from '@silkweave/auth'
import type { Adapter, AdapterGenerator } from '@silkweave/core'
import { buildRouter, createActionLogger, resolveAuth, type TrpcHandlerContext } from '@silkweave/trpc'
import { createExpressMiddleware } from '@trpc/server/adapters/express'
import type { IncomingMessage, ServerResponse } from 'http'
import { reserveSlot, type NodeMiddleware } from '../lib/slot.js'
import type { NestSilkweaveAdapter } from '../lib/types.js'

export interface TrpcAdapterOptions {
  /** URL prefix at which the tRPC handler is mounted. Default `'/trpc'`. */
  basePath?: string
  /** Optional bearer-token auth applied to every tRPC procedure. */
  auth?: AuthConfig
}

/**
 * tRPC adapter for `@silkweave/nestjs`. Builds a tRPC router from discovered
 * `@Action` methods via `@silkweave/trpc`'s `buildRouter` and mounts the
 * resulting `createExpressMiddleware()` at the configured base path on Nest's
 * underlying HTTP server.
 *
 * Action names with dots (e.g. `users.list` from `@Actions('users')`) collapse
 * to camelCase procedure keys (`usersList`) for v1 — flat router only.
 *
 * Works on `@nestjs/platform-express`. On `@nestjs/platform-fastify`, register
 * `@fastify/express` first so Nest can mount Express-style middleware.
 */
export function trpc(options: TrpcAdapterOptions = {}): NestSilkweaveAdapter {
  return {
    name: 'trpc',
    install: (host: HttpAdapterHost): AdapterGenerator => {
      const httpAdapter = host.httpAdapter
      if (!httpAdapter) {
        throw new Error('@silkweave/nestjs trpc(): HttpAdapterHost.httpAdapter is not available.')
      }
      const basePath = (options.basePath ?? '/trpc').replace(/\/$/, '') || '/'
      const setHandler = reserveSlot(httpAdapter as unknown as { use: (path: string, h: NodeMiddleware) => unknown }, basePath, 'tRPC')
      return (_silkweaveOptions, baseContext): Adapter => {
        const context = baseContext.fork({ adapter: 'trpc' })
        return {
          context,
          start: async (actions) => {
            const router = buildRouter(actions)
            const logger = createActionLogger()
            const createContext = async (
              opts: { req: IncomingMessage; res: ServerResponse }
            ): Promise<TrpcHandlerContext> => {
              const resolved = await resolveAuth(
                options.auth,
                opts.req.headers.authorization,
                context.fork({ request: opts.req })
              )
              if (resolved.kind === 'error') {
                for (const [key, value] of Object.entries<string>(resolved.error.headers)) {
                  opts.res.setHeader(key, value)
                }
                opts.res.statusCode = resolved.error.statusCode
                opts.res.setHeader('Content-Type', 'application/json')
                opts.res.end(JSON.stringify(resolved.error.body))
                throw new Error('Unauthorized')
              }
              return {
                silkweaveContext: context.fork({
                  logger,
                  request: opts.req,
                  response: opts.res,
                  ...(resolved.authInfo ? { auth: resolved.authInfo } : {})
                })
              }
            }
            const middleware = createExpressMiddleware({ router, createContext })
            setHandler(middleware as unknown as NodeMiddleware)
          },
          stop: async () => { /* Nest owns the HTTP server */ }
        }
      }
    }
  }
}

export { type InferTrpcRouter } from '@silkweave/trpc'
