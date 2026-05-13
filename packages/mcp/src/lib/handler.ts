import { InMemoryEventStore } from '@modelcontextprotocol/sdk/examples/shared/inMemoryEventStore.js'
import { createMcpExpressApp, CreateMcpExpressAppOptions } from '@modelcontextprotocol/sdk/server/express.js'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js'
import { AuthConfig, AuthInfo, generateProtectedResourceMetadata, OAuthRequest, OAuthResponse, validateToken } from '@silkweave/auth'
import { Action, SilkweaveContext, SilkweaveOptions } from '@silkweave/core'
import { createLogger } from '@silkweave/logger'
import { capitalCase, pascalCase } from 'change-case'
import cors, { CorsOptions } from 'cors'
import { randomUUID } from 'crypto'
import express, { Express, Request, Response } from 'express'
import { readFile } from 'fs/promises'
import { AsyncLocalStorage } from 'node:async_hooks'
import { handleToolError, jsonToolResult, smartToolResult } from '../util/result.js'
import { SideloadResource } from '../util/sideload.js'

const authStorage = new AsyncLocalStorage<AuthInfo>()

/** Headers required by the MCP protocol that must always be exposed when CORS is in use. */
export const MCP_REQUIRED_HEADERS = ['WWW-Authenticate', 'Mcp-Session-Id', 'Last-Event-Id', 'Mcp-Protocol-Version']

export interface CreateMcpExpressHandlerOptions extends CreateMcpExpressAppOptions {
  /** Bearer-token / OAuth auth configuration. Omit to disable auth entirely. */
  auth?: AuthConfig
  /** CORS configuration. `false` to disable, `true`/`undefined` for permissive defaults, or a CorsOptions object. */
  cors?: CorsOptions | boolean
  /** Hostname for the underlying express app (used by some MCP SDK checks). Default `'0.0.0.0'`. */
  host?: string
  /** Mount the `/resource/:id` sideload route on the returned app. Default `true`. */
  sideloadResources?: boolean
}

function toOAuthReq(req: Request): OAuthRequest {
  return {
    method: req.method,
    url: new URL(req.url, `${req.protocol}://${req.get('host')}`),
    headers: Object.fromEntries(Object.entries(req.headers).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v])),
    body: req.body as Record<string, string> | undefined
  }
}

function sendOAuth(res: Response, oauthRes: OAuthResponse) {
  for (const [key, value] of Object.entries(oauthRes.headers)) { res.header(key, value) }
  if (oauthRes.body) {
    res.status(oauthRes.status).send(typeof oauthRes.body === 'string' ? oauthRes.body : JSON.stringify(oauthRes.body))
  } else {
    res.status(oauthRes.status).end()
  }
}

function mountOAuthRoutes(app: Express, auth: AuthConfig): Set<string> {
  const provider = auth.provider!
  const callbackPath = auth.callbackPath ?? '/auth/callback'

  app.get('/.well-known/oauth-authorization-server', (_req: Request, res: Response) => {
    sendOAuth(res, provider.metadata())
  })
  app.get('/authorize', async (req: Request, res: Response) => {
    sendOAuth(res, await provider.authorize(toOAuthReq(req)))
  })
  app.get(callbackPath, async (req: Request, res: Response) => {
    sendOAuth(res, await provider.callback(toOAuthReq(req)))
  })
  app.post('/token', express.urlencoded({ extended: false }), async (req: Request, res: Response) => {
    sendOAuth(res, await provider.token(toOAuthReq(req)))
  })
  app.post('/register', express.json(), async (req: Request, res: Response) => {
    sendOAuth(res, await provider.register(toOAuthReq(req)))
  })

  return new Set(['/.well-known/oauth-authorization-server', '/authorize', callbackPath, '/token', '/register'])
}

function mountAuthMiddleware(app: Express, auth: AuthConfig, oauthPaths: Set<string>, context: SilkweaveContext) {
  app.use(async (req: Request, res: Response, next: (err?: unknown) => void) => {
    if (req.path.startsWith('/.well-known/') || oauthPaths.has(req.path)) { return next() }
    const result = await validateToken(req.headers.authorization, auth, context.fork({ request: req }))
    if (result.error) {
      for (const [key, value] of Object.entries(result.error.headers)) {
        res.header(key, value)
      }
      res.status(result.error.statusCode).json(result.error.body)
      return
    }
    if (result.auth) {
      authStorage.run(result.auth, () => { next() })
    } else {
      next()
    }
  })
}

function registerTools(server: McpServer, actions: Action[], context: SilkweaveContext) {
  for (const action of actions) {
    server.registerTool(pascalCase(action.name), {
      title: capitalCase(action.name),
      description: action.description,
      inputSchema: action.input
    }, async (input, extra) => {
      const logger = createLogger({
        stream: process.stderr,
        onLog: (level, data) => {
          extra.sendNotification({ method: 'notifications/message', params: { level, data } })
        },
        onProgress: ({ progress, total, message }) => {
          if (!extra._meta?.progressToken) { return }
          extra.sendNotification({
            method: 'notifications/progress',
            params: { progress, total, message, progressToken: extra._meta.progressToken }
          })
        }
      })
      const currentAuth = authStorage.getStore()
      const actionContext = context.fork({ logger, extra, ...(currentAuth ? { auth: currentAuth } : {}) })
      const disposition = extra._meta?.disposition
      return action.run(input, actionContext).then((result) => {
        if (action.toolResult) {
          const response = action.toolResult(result, actionContext)
          if (response) { return response }
        }
        if (disposition === 'json') {
          return jsonToolResult(result)
        } else {
          return smartToolResult(result)
        }
      }).catch(handleToolError)
    })
  }
}

function createMcpServer(options: SilkweaveOptions, actions: Action[], context: SilkweaveContext): McpServer {
  const server = new McpServer({
    name: options.name,
    description: options.description,
    version: options.version
  }, {
    capabilities: { tools: {}, logging: {} }
  })
  registerTools(server, actions, context)
  return server
}

function createSessionTransport(transports: Record<string, StreamableHTTPServerTransport>): StreamableHTTPServerTransport {
  const eventStore = new InMemoryEventStore()
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
    enableJsonResponse: false,
    eventStore,
    onsessioninitialized: (sId) => {
      console.log(`Session initialized with ID: ${sId}`)
      transports[sId] = transport
    }
  })
  transport.onerror = (error) => {
    console.error(error)
  }
  transport.onclose = () => {
    const sid = transport.sessionId
    if (sid && transports[sid]) {
      console.log(`Transport closed for session ${sid}, removing from transports map`)
      delete transports[sid]
    }
  }
  return transport
}

function mountMcpTransport(
  app: Express,
  transports: Record<string, StreamableHTTPServerTransport>,
  createServer: () => McpServer
) {
  app.post('/mcp', async (req: Request, res: Response) => {
    const sessionId = req.headers['mcp-session-id'] as string | undefined
    try {
      if (sessionId && transports[sessionId]) {
        await transports[sessionId].handleRequest(req, res, req.body)
        return
      }

      if (!isInitializeRequest(req.body)) {
        res.status(404).json({
          jsonrpc: '2.0',
          error: { code: -32_000, message: 'Session not found' },
          id: null
        })
        return
      }

      const transport = createSessionTransport(transports)
      await createServer().connect(transport)
      await transport.handleRequest(req, res, req.body)
    } catch (error) {
      console.error('Error handling MCP request:', error)
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: '2.0',
          error: { code: -32_603, message: 'Internal server error' },
          id: null
        })
      }
    }
  })

  const handleSessionStream = async (req: Request, res: Response) => {
    const sessionId = req.headers['mcp-session-id'] as string | undefined
    if (!sessionId || !transports[sessionId]) {
      res.status(400).send('Invalid or missing session ID')
      return
    }
    const transport = transports[sessionId]
    await transport.handleRequest(req, res)
  }

  app.get('/mcp', handleSessionStream)
  app.delete('/mcp', handleSessionStream)
  app.get('/mcp/resource/:id', handleSessionStream)
}

/**
 * Build an Express sub-app exposing the MCP Streamable HTTP transport, OAuth
 * routes (if configured), and bearer-token auth middleware. The returned app
 * can be listened on directly OR mounted onto an existing server via
 * `parentApp.use(basePath, app)` / Nest's `httpAdapter.use(basePath, app)`.
 *
 * Used by `@silkweave/mcp`'s `http()` adapter (server-owning) and
 * `@silkweave/nestjs`'s `mcp()` adapter (mounts on Nest's HTTP server).
 */
export function createMcpExpressHandler(
  silkweaveOptions: SilkweaveOptions,
  context: SilkweaveContext,
  actions: Action[],
  options: CreateMcpExpressHandlerOptions = {}
): Express {
  const { auth, cors: corsConfig, host = '0.0.0.0', sideloadResources = true, ...mcpOptions } = options
  const app = createMcpExpressApp({ ...mcpOptions, host })

  if (corsConfig !== false) {
    const userConfig = corsConfig === true || corsConfig === undefined ? {} : corsConfig
    const userExposed = userConfig.exposedHeaders
    const exposedHeaders = [
      ...MCP_REQUIRED_HEADERS,
      ...(Array.isArray(userExposed) ? userExposed : userExposed ? [userExposed] : [])
    ]
    app.use(cors({ origin: '*', ...userConfig, exposedHeaders }))
  }

  if (auth?.authorizationServers?.length && auth.resourceUrl) {
    app.get('/.well-known/oauth-protected-resource', (_req: Request, res: Response) => {
      const metadata = generateProtectedResourceMetadata(auth.resourceUrl!, auth.authorizationServers!)
      res.json(metadata)
    })
  }

  const oauthPaths = auth?.provider ? mountOAuthRoutes(app, auth) : new Set<string>()

  if (auth) {
    mountAuthMiddleware(app, auth, oauthPaths, context)
  }

  if (sideloadResources) {
    app.get('/resource/:id', async (req: Request, res: Response) => {
      const id = req.params.id
      if (!id || typeof id !== 'string') { throw new Error('Invalid ID') }
      const resourceMeta: SideloadResource = JSON.parse(await readFile(`resources/${id}.json`, 'utf-8'))
      const buffer = await readFile(`resources/${id}`)
      res.status(200)
      res.header('Content-Type', resourceMeta.contentType)
      res.send(buffer)
    })
  }

  const transports: Record<string, StreamableHTTPServerTransport> = {}
  mountMcpTransport(app, transports, () => createMcpServer(silkweaveOptions, actions, context))

  return app
}
