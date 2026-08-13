import { AuthConfig } from '@silkweave/auth'
import { Adapter, AdapterGenerator, SilkweaveOptions } from '@silkweave/core'
import { createHTTPHandler } from '@trpc/server/adapters/standalone'
import { IncomingMessage, ServerResponse } from 'http'
import { buildRouter, TrpcHandlerContext } from '../lib/buildRouter.js'
import { authResponseMeta, createActionLogger, resolveIdentity, throwAuthError, type Authenticate } from '../lib/createContext.js'

export interface TrpcNodeAdapterOptions {
  /**
   * URL prefix stripped from incoming requests before tRPC routing. Default
   * `/trpc/`; normalized to a trailing slash, which is the form the underlying
   * handler's `basePath` slicing expects.
   */
  endpoint?: string
  auth?: AuthConfig
  /**
   * Resolve the caller from the request itself (a session cookie, typically)
   * instead of a bearer token. Returning `null` falls through to `auth`. See
   * `Authenticate` for the security stance - notably that this bypasses every
   * check `validateToken` performs, and the CSRF note.
   */
  authenticate?: Authenticate<IncomingMessage>
}

export type NodeHandler = (req: IncomingMessage, res: ServerResponse) => void

export interface TrpcNodeAdapter {
  adapter: AdapterGenerator
  handler: NodeHandler
}

/**
 * Creates a tRPC adapter that exposes a `node:http` handler instead of binding
 * its own port - for mounting on an HTTP server your application already owns,
 * alongside its other routes.
 *
 * That shape is the one a real Node app has, and it is not just a convenience:
 * an app whose browser talks tRPC and whose agent talks MCP usually needs both
 * on one origin, because a browser cannot put an `Authorization` header on a
 * WebSocket upgrade - the only credential a tab can present is a per-origin
 * cookie. Move the API to another port and the app's login stops authenticating
 * the socket.
 *
 * ```ts
 * const api = trpcNode({ endpoint: '/trpc', auth })
 * const server = silkweave({ ... }).adapter(api.adapter).actions(actions)
 * export type AppRouter = InferTrpcRouter<typeof server>
 * await server.start()
 *
 * httpServer.on('request', (req, res) => {
 *   if (req.url?.startsWith('/trpc')) { return api.handler(req, res) }
 *   // ...the rest of your app
 * })
 * ```
 *
 * The handler waits for `server.start()` to complete before dispatching, and
 * answers 503 if the router failed to build - a request arriving before start
 * resolves is normal on a server that binds its port before wiring routes.
 *
 * **The handler does not verify the prefix**: the underlying tRPC handler slices
 * `endpoint` off the path unconditionally, so route only matching URLs into it
 * (as the example above does). CORS is intentionally not configured - a mounted
 * handler does not own the response headers of the server it is mounted on.
 */
export function trpcNode(options: TrpcNodeAdapterOptions = {}): TrpcNodeAdapter {
  const endpoint = (options.endpoint ?? '/trpc/').replace(/\/?$/, '/')

  let resolveReady!: () => void
  let rejectReady!: (error: unknown) => void
  const ready = new Promise<void>((resolve, reject) => { resolveReady = resolve; rejectReady = reject })

  let handler: NodeHandler | undefined

  // A boot failure rejects `ready` before any request has attached a handler,
  // which Node reports as an unhandled rejection. The real surfacing happens in
  // start() (which rethrows) and per-request below.
  ready.catch(() => { /* surfaced via start() / per-request dispatch */ })

  const adapter: AdapterGenerator = (_silkweaveOptions: SilkweaveOptions, baseContext): Adapter => {
    const context = baseContext.fork({ adapter: 'trpc' })
    return {
      context,
      start: async (actions) => {
        let router
        try {
          router = buildRouter(actions)
        } catch (error) {
          // Reject readiness so requests get a 503 instead of hanging forever,
          // then rethrow so the builder's start() rejects too.
          rejectReady(error)
          throw error
        }
        const logger = createActionLogger()

        const createContext = async (
          opts: { req: IncomingMessage; res: ServerResponse }
        ): Promise<TrpcHandlerContext> => {
          const resolved = await resolveIdentity(
            options.authenticate,
            options.auth,
            opts.req,
            opts.req.headers.authorization,
            context.fork({ request: opts.req })
          )
          if (resolved.kind === 'error') {
            // Signal the 401/403 through tRPC (see throwAuthError). Writing to
            // opts.res here would race tRPC's own error write and crash the
            // process with ERR_STREAM_WRITE_AFTER_END on the finished response.
            throwAuthError(resolved.error)
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

        handler = createHTTPHandler({ router, basePath: endpoint, createContext, responseMeta: authResponseMeta })
        resolveReady()
      },
      stop: async () => { /* no-op - the host owns the server */ }
    }
  }

  const dispatch: NodeHandler = (req, res) => {
    ready.then(
      () => { handler!(req, res) },
      () => {
        res.statusCode = 503
        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify({ error: 'not_ready', message: 'tRPC adapter failed to start' }))
      }
    )
  }

  return { adapter, handler: dispatch }
}
