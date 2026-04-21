import { AuthConfig } from '@silkweave/auth'
import { Adapter, AdapterGenerator, SilkweaveOptions } from '@silkweave/core'
import { fetchRequestHandler } from '@trpc/server/adapters/fetch'
import { buildRouter, TrpcHandlerContext } from '../lib/buildRouter.js'
import { createActionLogger, resolveAuth } from '../lib/createContext.js'

export interface TrpcFetchAdapterOptions {
  /** URL prefix stripped from incoming requests before tRPC routing. Default `/trpc`. */
  endpoint?: string
  auth?: AuthConfig
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
  const ready = new Promise<void>((resolve) => { resolveReady = resolve })

  let handler: FetchHandler = async () => new Response(
    JSON.stringify({ error: 'not_ready', message: 'tRPC adapter has not started yet' }),
    { status: 503, headers: { 'Content-Type': 'application/json' } }
  )

  const adapter: AdapterGenerator = (_silkweaveOptions: SilkweaveOptions, baseContext): Adapter => {
    const context = baseContext.fork({ adapter: 'trpc' })
    return {
      context,
      start: async (actions) => {
        const router = buildRouter(actions)
        const logger = createActionLogger()

        const createContext = async (
          opts: { req: Request }
        ): Promise<TrpcHandlerContext> => {
          const resolved = await resolveAuth(
            options.auth,
            opts.req.headers.get('authorization'),
            context.fork({ request: opts.req })
          )
          if (resolved.kind === 'error') {
            const err = new Error('Unauthorized') as Error & { silkweaveAuthError?: typeof resolved.error }
            err.silkweaveAuthError = resolved.error
            throw err
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
          try {
            return await fetchRequestHandler({
              endpoint,
              req: request,
              router,
              createContext
            })
          } catch (error) {
            const authError = (error as { silkweaveAuthError?: { statusCode: number; headers: Record<string, string>; body: object } }).silkweaveAuthError
            if (authError) {
              return new Response(JSON.stringify(authError.body), {
                status: authError.statusCode,
                headers: { 'Content-Type': 'application/json', ...authError.headers }
              })
            }
            throw error
          }
        }

        resolveReady()
      },
      stop: async () => { /* no-op for fetch adapter */ }
    }
  }

  const dispatch: FetchHandler = async (request) => {
    await ready
    return handler(request)
  }

  return {
    adapter,
    handler: dispatch,
    GET: dispatch,
    POST: dispatch
  }
}
