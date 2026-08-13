import { AuthConfig } from '@silkweave/auth'
import { Adapter, AdapterGenerator, SilkweaveOptions } from '@silkweave/core'
import { fetchRequestHandler } from '@trpc/server/adapters/fetch'
import { buildRouter, TrpcHandlerContext } from '../lib/buildRouter.js'
import {
  authResponseMeta,
  createActionLogger,
  resolveIdentity,
  throwAuthError,
  type Authenticate
} from '../lib/createContext.js'

export interface TrpcFetchAdapterOptions {
  /** URL prefix stripped from incoming requests before tRPC routing. Default `/trpc`. */
  endpoint?: string
  auth?: AuthConfig
  /**
   * Resolve the caller from the request itself (a session cookie, typically)
   * instead of a bearer token. Returning `null` falls through to `auth`. See
   * `Authenticate` for the security stance - notably that this bypasses every
   * check `validateToken` performs, and the CSRF note.
   */
  authenticate?: Authenticate<Request>
}

export type FetchHandler = (request: Request) => Promise<Response>

export interface TrpcFetchAdapter {
  adapter: AdapterGenerator
  handler: FetchHandler
  GET: FetchHandler
  POST: FetchHandler
}

/**
 * Creates a tRPC adapter that exposes a fetch-compatible handler instead of
 * binding its own HTTP server. Use in Astro API routes, Vercel serverless
 * functions, Cloudflare Workers, or any Web Standard runtime.
 *
 * The returned `handler` waits for `server.start()` to complete (via an internal
 * `_ready` promise) before dispatching requests, so it's safe to call from a
 * cold-started serverless invocation.
 *
 * CORS is intentionally not configured here - handle it in your host framework
 * (Astro middleware, `vercel.json` headers, Worker response headers, etc).
 */
export function trpcFetch(options: TrpcFetchAdapterOptions = {}): TrpcFetchAdapter {
  const endpoint = (options.endpoint ?? '/trpc').replace(/\/$/, '')

  let resolveReady!: () => void
  let rejectReady!: (error: unknown) => void
  const ready = new Promise<void>((resolve, reject) => {
    resolveReady = resolve
    rejectReady = reject
  })

  let handler: FetchHandler | undefined

  // A boot failure rejects `ready` before any request has attached a handler,
  // which Node reports as an unhandled rejection. The real surfacing happens in
  // start() (which rethrows) and per-request below.
  ready.catch(() => {
    /* surfaced via start() / per-request dispatch */
  })

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

        const createContext = async (opts: { req: Request }): Promise<TrpcHandlerContext> => {
          const resolved = await resolveIdentity(
            options.authenticate,
            options.auth,
            opts.req,
            opts.req.headers.get('authorization'),
            context.fork({ request: opts.req })
          )
          if (resolved.kind === 'error') {
            // @trpc/server captures createContext errors internally and never
            // rethrows, so a plain throw would surface as a 500. Signal the
            // 401/403 as a TRPCError whose challenge headers authResponseMeta
            // applies to the Response.
            throwAuthError(resolved.error)
          }
          return {
            silkweaveContext: context.fork({
              logger,
              request: opts.req,
              ...(resolved.authInfo ? { auth: resolved.authInfo } : {})
            })
          }
        }

        handler = async (request: Request): Promise<Response> => {
          return fetchRequestHandler({
            endpoint,
            req: request,
            router,
            createContext,
            responseMeta: authResponseMeta
          })
        }

        resolveReady()
      },
      stop: async () => {
        /* no-op for fetch adapter */
      }
    }
  }

  const dispatch: FetchHandler = async (request) => {
    try {
      await ready
    } catch {
      return new Response(JSON.stringify({ error: 'not_ready', message: 'tRPC adapter failed to start' }), {
        status: 503,
        headers: { 'Content-Type': 'application/json' }
      })
    }
    return handler!(request)
  }

  return {
    adapter,
    handler: dispatch,
    GET: dispatch,
    POST: dispatch
  }
}
