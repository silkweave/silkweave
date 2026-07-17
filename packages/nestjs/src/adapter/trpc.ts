import { AuthConfig } from '@silkweave/auth'
import { buildRouter, createActionLogger, resolveAuth, type TrpcHandlerContext } from '@silkweave/trpc'
import { createExpressMiddleware } from '@trpc/server/adapters/express'
import { TRPCError } from '@trpc/server'
import cors, { type CorsOptions } from 'cors'
import type { Request, RequestHandler, Response } from 'express'
import type { NestAdapterRegisterContext, NestSilkweaveAdapter } from '../lib/types.js'
import { buildValidationErrorEmitter } from '../lib/validationTelemetry.js'

export interface TrpcAdapterOptions {
  /** URL prefix the tRPC handler mounts on. Default `'/trpc'`. */
  basePath?: string
  /**
   * CORS configuration. `false` to disable, `true`/omitted for permissive
   * defaults, or a `CorsOptions` object. For cookie-based auth set
   * `{ origin: '<spa-origin>', credentials: true }` so the browser sends the
   * session cookie (`credentials: 'include'` / `withCredentials`).
   */
  cors?: CorsOptions | boolean
  /**
   * Optional bearer-token / OAuth 2.1 config. Usually omitted - `@Trpc` routes
   * authenticate with their own `@UseGuards()` reading the real Express request
   * (cookies/headers), so no separate auth config is needed. Provide this only
   * to additionally validate an `Authorization` bearer at the transport edge.
   */
  auth?: AuthConfig
}

function resolveCors(config: CorsOptions | boolean | undefined): RequestHandler | null {
  if (config === false) { return null }
  const userConfig = config === true || config === undefined ? {} : config
  return cors({ origin: '*', ...userConfig }) as RequestHandler
}

/**
 * tRPC adapter for `@silkweave/nestjs`. Mounts a single tRPC HTTP handler (httpBatch
 * for queries/mutations, SSE for subscriptions) on Nest's HTTP adapter at the
 * configured `basePath` (default `/trpc`), built from every `@Trpc`-decorated
 * controller method.
 *
 * Each procedure runs the method's `@UseGuards()` first, with the guard receiving
 * a real `ExecutionContext` whose `switchToHttp().getRequest()` is the **actual
 * Express request** (cookies/headers/`req.user`) - so cookie-session auth works
 * with no separate auth config. A denying guard surfaces to the client as a
 * `TRPCError` whose `data.httpStatus` is the guard's HTTP status (401/403).
 */
export function trpc(options: TrpcAdapterOptions = {}): NestSilkweaveAdapter {
  return {
    name: 'trpc',
    register({ httpAdapter, baseContext, actions, onToolCall }: NestAdapterRegisterContext): void {
      const basePath = (options.basePath ?? '/trpc').replace(/\/$/, '')
      if (!basePath) { throw new Error('@silkweave/nestjs trpc(): basePath cannot be empty or "/" - pick a path like "/trpc".') }

      const router = buildRouter(actions)
      const logger = createActionLogger()

      const middleware = createExpressMiddleware({
        router,
        onError: buildValidationErrorEmitter(actions, baseContext, onToolCall),
        createContext: async ({ req, res }: { req: Request; res: Response }): Promise<TrpcHandlerContext> => {
          const resolved = await resolveAuth(options.auth, req.headers.authorization, baseContext.fork({ request: req }))
          if (resolved.kind === 'error') {
            throw new TRPCError({ code: 'UNAUTHORIZED', message: resolved.error.body.error_description })
          }
          return {
            silkweaveContext: baseContext.fork({
              logger,
              request: req,
              response: res,
              ...(resolved.authInfo ? { auth: resolved.authInfo } : {})
            })
          }
        }
      }) as unknown as RequestHandler

      const adapter = httpAdapter as unknown as { use: (path: string, ...handlers: RequestHandler[]) => unknown }
      const corsHandler = resolveCors(options.cors ?? true)
      const handlers = corsHandler ? [corsHandler, middleware] : [middleware]
      adapter.use(basePath, ...handlers)
    }
  }
}
