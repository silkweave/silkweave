import { AuthConfig } from '@silkweave/auth'
import { AdapterFactory } from '@silkweave/core'
import { createHTTPHandler } from '@trpc/server/adapters/standalone'
import cors, { CorsOptions } from 'cors'
import http, { IncomingMessage, ServerResponse } from 'http'
import { buildRouter, TrpcHandlerContext } from '../lib/buildRouter.js'
import { createActionLogger, resolveAuth } from '../lib/createContext.js'

export interface TrpcAdapterOptions {
  host?: string
  port?: number
  /** URL prefix stripped from incoming requests before tRPC routing. Default `/trpc/`. */
  endpoint?: string
  /** CORS configuration. `false` to disable, `true`/`undefined` for permissive defaults, or a CorsOptions object. */
  cors?: CorsOptions | boolean
  auth?: AuthConfig
}

type CorsMiddleware = (req: IncomingMessage, res: ServerResponse, next: (err?: unknown) => void) => void

function resolveCors(corsConfig: CorsOptions | boolean | undefined): CorsMiddleware | null {
  if (corsConfig === false) { return null }
  const userConfig = corsConfig === true || corsConfig === undefined ? {} : corsConfig
  return cors({ origin: '*', ...userConfig }) as CorsMiddleware
}

export const trpc: AdapterFactory<TrpcAdapterOptions> = (options) => {
  return (_silkweaveOptions, baseContext) => {
    const context = baseContext.fork({ adapter: 'trpc' })
    const host = options.host ?? '0.0.0.0'
    const port = options.port ?? 8080
    const endpoint = (options.endpoint ?? '/trpc/').replace(/\/?$/, '/')
    let server: http.Server | undefined

    return {
      context,
      start: async (actions) => {
        const router = buildRouter(actions)
        const corsMiddleware = resolveCors(options.cors)
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
            for (const [key, value] of Object.entries(resolved.error.headers)) {
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
              ...(resolved.authInfo ? { auth: resolved.authInfo } : {})
            })
          }
        }

        const trpcHandler = createHTTPHandler({ router, basePath: endpoint, createContext })

        const handler = (req: IncomingMessage, res: ServerResponse) => {
          if (!req.url?.startsWith(endpoint)) {
            res.statusCode = 404
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ error: 'not_found', message: `No route for ${req.url}` }))
            return
          }
          trpcHandler(req, res)
        }

        server = http.createServer((req, res) => {
          if (corsMiddleware) {
            corsMiddleware(req, res, () => {
              if (req.method === 'OPTIONS') { res.statusCode = 204; res.end(); return }
              handler(req, res)
            })
          } else {
            handler(req, res)
          }
        })

        await new Promise<void>((resolve) => {
          server!.listen(port, host, () => { resolve() })
        })
      },
      stop: async () => {
        if (!server) { return }
        await new Promise<void>((resolve, reject) => {
          server!.close((err) => {
            if (err) { reject(err) } else { resolve() }
          })
        })
      }
    }
  }
}
