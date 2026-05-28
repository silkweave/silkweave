import { AuthConfig } from '@silkweave/auth'
import { buildRouter, createActionLogger, resolveAuth, type TrpcHandlerContext } from '@silkweave/trpc'
import { createExpressMiddleware } from '@trpc/server/adapters/express'
import type { IncomingMessage, ServerResponse } from 'http'
import type { NestAdapterRegisterContext, NestSilkweaveAdapter } from '../lib/types.js'

export interface TrpcAdapterOptions {
  /** URL prefix at which the tRPC handler is mounted. Default `'/trpc'`. */
  basePath?: string
  /** Optional bearer-token auth applied to every tRPC procedure. */
  auth?: AuthConfig
}

/**
 * tRPC adapter for `@silkweave/nestjs`. Builds a tRPC router from discovered
 * `@Action` methods and mounts the resulting express middleware at
 * `basePath` on Nest's HTTP adapter.
 *
 * Action names with dots (e.g. `users.list` from `@Actions('users')`) collapse
 * to camelCase procedure keys (`usersList`).
 *
 * Works on `@nestjs/platform-express`. On `@nestjs/platform-fastify`, register
 * `@fastify/express` first so Nest can serve Express-style middleware.
 */
export function trpc(options: TrpcAdapterOptions = {}): NestSilkweaveAdapter {
  return {
    name: 'trpc',
    register({ httpAdapter, baseContext, actions }: NestAdapterRegisterContext): void {
      const basePath = (options.basePath ?? '/trpc').replace(/\/$/, '') || '/'
      const router = buildRouter(actions)
      const logger = createActionLogger()
      const createContext = async (
        opts: { req: IncomingMessage; res: ServerResponse }
      ): Promise<TrpcHandlerContext> => {
        const resolved = await resolveAuth(options.auth, opts.req.headers.authorization, baseContext.fork({ request: opts.req }))
        if (resolved.kind === 'error') {
          for (const [key, value] of Object.entries<string>(resolved.error.headers)) { opts.res.setHeader(key, value) }
          opts.res.statusCode = resolved.error.statusCode
          opts.res.setHeader('Content-Type', 'application/json')
          opts.res.end(JSON.stringify(resolved.error.body))
          throw new Error('Unauthorized')
        }
        return {
          silkweaveContext: baseContext.fork({
            logger,
            request: opts.req,
            response: opts.res,
            ...(resolved.authInfo ? { auth: resolved.authInfo } : {})
          })
        }
      }
      const middleware = createExpressMiddleware({ router, createContext })
      ;(httpAdapter as unknown as { use: (path: string, h: unknown) => unknown }).use(basePath, middleware)
    }
  }
}

export { type InferTrpcRouter } from '@silkweave/trpc'
