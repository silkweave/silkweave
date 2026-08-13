import { AuthConfig } from '@silkweave/auth'
import {
  authMiddleware,
  mcpCors,
  mcpTransport,
  oauthRoutes,
  protectedResourceMetadata,
  sideloadResource,
  type FilterActions
} from '@silkweave/mcp/server'
import { type CorsOptions } from 'cors'
import express, { type RequestHandler } from 'express'
import type { NestAdapterRegisterContext, NestSilkweaveAdapter } from '../lib/types.js'

export interface McpAdapterOptions {
  /** URL prefix the MCP namespace lives under - the transport itself is at this exact path. Default `'/mcp'`. */
  basePath?: string
  /** Optional bearer-token / OAuth 2.1 config. */
  auth?: AuthConfig
  /** CORS configuration. `false` to disable, `true`/omitted for permissive defaults, or a `CorsOptions` object. */
  cors?: CorsOptions | boolean
  /**
   * Extra paths that also serve the MCP transport, beyond `basePath`. For a
   * multi-resource server these are the per-tenant connector URLs (e.g.
   * `['/:spaceId']`), each mapped by the `auth.resourceUrl` resolver to its own
   * protected resource and token audience. Mounted after the OAuth/well-known
   * routes; note Express 5 matches `'/:spaceId'` against every single segment.
   */
  transportPaths?: string[]
  /** Mount the sideload resource route at `${basePath}/resource/:id`. Default `true`. */
  sideloadResources?: boolean
  /** Directory the sideload route reads from. Default `'resources'`. */
  resourceDir?: string
  /**
   * Per-request tool filter, applied before tools are registered on every
   * `POST ${basePath}` (the stateless transport recomputes the tool list per
   * request, so e.g. API-key permission changes apply on the next
   * `tools/list`). Receives the synthesized actions (with their `tags`) and a
   * request stand-in (`headers`/`url`/`method`/`toolName`). A throw surfaces
   * as its `SilkweaveError.statusCode` (else 500) - never an empty tool list.
   */
  filterActions?: FilterActions
}

function compose(...handlers: RequestHandler[]): RequestHandler {
  return (req, res, next) => {
    let i = 0
    const dispatch: () => void = () => {
      const h = handlers[i++]
      if (!h) {
        return next()
      }
      h(req, res, (err) => (err ? next(err) : dispatch()))
    }
    dispatch()
  }
}

/**
 * MCP adapter for `@silkweave/nestjs`. Registers the MCP Streamable HTTP
 * transport, sideload, well-known and OAuth routes individually on Nest's
 * HTTP adapter at the configured `basePath` (default `/mcp`):
 *
 * - `POST ${basePath}` - Streamable HTTP transport (GET/DELETE answer 405: the
 *   stateless transport is POST-only)
 * - `GET ${basePath}/resource/:id` - sideload (`sideloadResources` opt-out)
 * - `GET ${basePath}/.well-known/oauth-protected-resource` - RFC 9728 metadata (when `auth.resourceUrl`/`auth.authorizationServers` set)
 * - `GET ${basePath}/authorize`, `POST ${basePath}/token`, `POST ${basePath}/register`, `GET ${basePath}${callbackPath}` (when `auth.provider` set)
 *
 * Each route is a real Nest-level route - they show up in
 * `RoutesResolver`'s log and there is no sub-app or middleware-slot
 * indirection.
 */
export function mcp(options: McpAdapterOptions = {}): NestSilkweaveAdapter {
  return {
    name: 'mcp',
    register({ httpAdapter, silkweaveOptions, baseContext, actions, onToolCall }: NestAdapterRegisterContext): void {
      const basePath = (options.basePath ?? '/mcp').replace(/\/$/, '')
      if (!basePath) {
        throw new Error('@silkweave/nestjs mcp(): basePath cannot be empty or "/" - pick a path like "/mcp".')
      }

      const adapter = httpAdapter as unknown as {
        get: (path: string, ...h: RequestHandler[]) => unknown
        post: (path: string, ...h: RequestHandler[]) => unknown
        delete: (path: string, ...h: RequestHandler[]) => unknown
      }

      const corsHandler = mcpCors(options.cors ?? true)
      const auth = options.auth
      const guard = auth ? authMiddleware(auth, baseContext) : null
      const prefix = (...handlers: (RequestHandler | null)[]): RequestHandler[] =>
        handlers.filter((h): h is RequestHandler => Boolean(h))

      // Public auth-discovery / OAuth routes - registered first so they're
      // never inadvertently guarded by the auth middleware.
      if (auth?.authorizationServers?.length && auth.resourceUrl) {
        if (typeof auth.resourceUrl === 'string') {
          adapter.get(
            `${basePath}/.well-known/oauth-protected-resource`,
            ...prefix(corsHandler, protectedResourceMetadata(auth))
          )
        } else {
          // Insertion-form metadata lives at the server ROOT by definition
          // (`/.well-known/oauth-protected-resource/<resource path>`), not under
          // basePath - that is the only place a spec-conformant client probes.
          adapter.get(
            '/.well-known/oauth-protected-resource{/*resource}',
            ...prefix(corsHandler, protectedResourceMetadata(auth, baseContext))
          )
        }
      }
      if (auth?.provider) {
        const oauth = oauthRoutes(auth)
        adapter.get(
          `${basePath}/.well-known/oauth-authorization-server`,
          ...prefix(corsHandler, oauth.wellKnownAuthServer)
        )
        // The MCP SDK probes RFC 8414 insertion form for a path'd issuer
        // (`/.well-known/oauth-authorization-server/mcp`) and never the append
        // form above, so serve the same document there too. Without this, AS
        // discovery fails and the client falls back to root-absolute
        // `/authorize` + `/register`, which nothing here mounts.
        if (basePath) {
          adapter.get(
            `/.well-known/oauth-authorization-server${basePath}`,
            ...prefix(corsHandler, oauth.wellKnownAuthServer)
          )
        }
        adapter.get(`${basePath}/authorize`, ...prefix(corsHandler, oauth.authorize))
        adapter.get(`${basePath}${oauth.callbackPath}`, ...prefix(corsHandler, oauth.callback))
        adapter.post(`${basePath}/token`, ...prefix(corsHandler, ...oauth.token))
        adapter.post(`${basePath}/register`, ...prefix(corsHandler, ...oauth.register))
      }

      // Protected routes - wrapped with auth middleware (when configured).
      const protect = guard ? (h: RequestHandler) => compose(guard, h) : (h: RequestHandler) => h

      if (options.sideloadResources !== false) {
        adapter.get(
          `${basePath}/resource/:id`,
          ...prefix(corsHandler, protect(sideloadResource({ resourceDir: options.resourceDir })))
        )
      }

      const transport = mcpTransport(silkweaveOptions, baseContext, actions, {
        filterActions: options.filterActions,
        onToolCall
      })
      for (const path of [basePath, ...(options.transportPaths ?? [])]) {
        adapter.post(path, ...prefix(corsHandler, express.json(), protect(transport.post)))
        // POST-only transport: 405 rather than Nest's default 404, which is what
        // MCP clients expect from a server offering no SSE stream.
        adapter.get(path, ...prefix(corsHandler, transport.methodNotAllowed))
        adapter.delete(path, ...prefix(corsHandler, transport.methodNotAllowed))
      }
    }
  }
}
