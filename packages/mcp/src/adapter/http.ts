import { createMcpExpressApp, type CreateMcpExpressAppOptions } from '@modelcontextprotocol/sdk/server/express.js'
import { AuthConfig } from '@silkweave/auth'
import { Action, AdapterFactory, createContext, OnToolCall, SilkweaveContext, SilkweaveOptions, Skill, SkillDefinition } from '@silkweave/core'
import { CorsOptions } from 'cors'
import express, { type Express } from 'express'
import { Server } from 'http'
import { authMiddleware } from '../handlers/auth.js'
import { mcpCors } from '../handlers/cors.js'
import { protectedResourceMetadata } from '../handlers/metadata.js'
import { oauthRoutes } from '../handlers/oauth.js'
import { type FilterActions } from '../handlers/filter.js'
import { sideloadResource } from '../handlers/sideload.js'
import { mcpTransport } from '../handlers/transport.js'

export interface StartMcpHttpOptions extends CreateMcpExpressAppOptions {
  host: string
  port: number
  auth?: AuthConfig
  /** CORS configuration. `false` to disable, omitted/`true` for permissive defaults, or a `CorsOptions` object. */
  cors?: CorsOptions | boolean
  /** Mount the `/resource/:id` sideload route. Default `true`. */
  sideloadResources?: boolean
  /** Directory the sideload route reads from. Default `'resources'`. */
  resourceDir?: string
  /**
   * Per-request tool filter, applied before `registerTools()` on every
   * `POST /mcp` (the stateless transport recomputes the tool list per request,
   * so permission changes apply on the next `tools/list`). See `FilterActions`
   * for the request stand-in (`headers`/`url`/`method`/`toolName`) and error
   * semantics (a throw surfaces as its `SilkweaveError.statusCode` or 500 -
   * never an empty tool list).
   */
  filterActions?: FilterActions
  /** Telemetry hook invoked once per tool call (fire-and-forget). */
  onToolCall?: OnToolCall
  /**
   * Agent skills to serve: `skill://` file resources + `ListSkills`/`GetSkill`
   * tools + a server-instructions pointer. Requires `@silkweave/skills`
   * (optional peer); resolved once at start.
   */
  skills?: (Skill | SkillDefinition)[]
  /** EXPERIMENTAL: also serve the SEP-2640 draft extension (`skills/list`/`skills/get` + capability). */
  skillsExtension?: boolean
}

/**
 * Build a fully-wired Express app that exposes the MCP Streamable HTTP
 * transport (plus OAuth / sideload / well-known routes when configured).
 *
 * Pass the resulting `app` to `app.listen(port, host)` yourself, or use the
 * top-level `startMcpServer()` / `http()` adapter conveniences.
 */
export function buildMcpExpressApp(
  silkweaveOptions: SilkweaveOptions,
  context: SilkweaveContext,
  actions: Action[],
  options: StartMcpHttpOptions
): Express {
  const { host, auth, cors: corsConfig, sideloadResources = true, resourceDir, filterActions, onToolCall, skills, skillsExtension, ...mcpAppOptions } = options
  const app = createMcpExpressApp({ ...mcpAppOptions, host })

  const corsHandler = mcpCors(corsConfig ?? true)
  if (corsHandler) { app.use(corsHandler) }

  if (auth?.authorizationServers?.length && auth.resourceUrl) {
    app.get('/.well-known/oauth-protected-resource', protectedResourceMetadata(auth))
  }

  let oauthPaths = new Set<string>()
  if (auth?.provider) {
    const oauth = oauthRoutes(auth)
    app.get('/.well-known/oauth-authorization-server', oauth.wellKnownAuthServer)
    app.get('/authorize', oauth.authorize)
    app.get(oauth.callbackPath, oauth.callback)
    app.post('/token', ...oauth.token)
    app.post('/register', ...oauth.register)
    oauthPaths = new Set(['/.well-known/oauth-authorization-server', '/authorize', oauth.callbackPath, '/token', '/register'])
  }

  if (auth) {
    const guard = authMiddleware(auth, context)
    app.use((req, res, next) => {
      if (req.path.startsWith('/.well-known/') || oauthPaths.has(req.path)) { return next() }
      return guard(req, res, next)
    })
  }

  if (sideloadResources) {
    app.get('/resource/:id', sideloadResource({ resourceDir }))
  }

  const transport = mcpTransport(silkweaveOptions, context, actions, { filterActions, onToolCall, skills, skillsExtension })
  app.post('/mcp', express.json(), transport.post)
  // Surface a skill boot failure (bad SKILL.md, missing @silkweave/skills) at
  // start rather than as per-request 500s.
  app.locals.mcpReady = transport.ready

  return app
}

/**
 * Spin up a standalone MCP Streamable HTTP server on `host:port` for the
 * given `actions`. Returns the underlying `Server` so callers can close it.
 *
 * Convenience for use cases that don't go through the `silkweave()` builder.
 */
export async function startMcpServer(
  silkweaveOptions: SilkweaveOptions,
  actions: Action[],
  options: StartMcpHttpOptions,
  context?: SilkweaveContext
): Promise<Server> {
  const ctx = context ?? createContext({ adapter: 'http' })
  const app = buildMcpExpressApp(silkweaveOptions, ctx, actions, options)
  return new Promise<Server>((resolve, reject) => {
    const server = app.listen(options.port, options.host, (error) => {
      if (error) { reject(error); return }
      console.log(`MCP Streamable HTTP Server listening on http://${options.host}:${options.port}/mcp`)
      resolve(server)
    })
  })
}

/**
 * Silkweave adapter that owns its own HTTP server. Composes the MCP handler
 * primitives into a fully-wired Express app and listens on `host:port`.
 */
export const http: AdapterFactory<StartMcpHttpOptions> = (options) => {
  return (silkweaveOptions, baseContext) => {
    const context = baseContext.fork({ adapter: 'http' })
    let httpServer: Server | undefined
    return {
      context,
      start: async (actions) => {
        const app = buildMcpExpressApp(silkweaveOptions, context, actions, options)
        await (app.locals.mcpReady as Promise<void>)
        httpServer = await new Promise<Server>((resolve, reject) => {
          const s = app.listen(options.port, options.host, (error) => {
            if (error) { reject(error); return }
            console.log(`MCP Streamable HTTP Server listening on http://${options.host}:${options.port}/mcp`)
            resolve(s)
          })
        })
      },
      stop: async () => {
        if (!httpServer) { return }
        await new Promise<void>((resolve, reject) => {
          httpServer!.close((err) => err ? reject(err) : resolve())
        })
        httpServer = undefined
      }
    }
  }
}
