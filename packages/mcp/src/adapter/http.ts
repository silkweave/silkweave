import { InMemoryEventStore } from '@modelcontextprotocol/sdk/examples/shared/inMemoryEventStore.js'
import { createMcpExpressApp, CreateMcpExpressAppOptions } from '@modelcontextprotocol/sdk/server/express.js'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js'
import { AuthConfig, AuthInfo, generateProtectedResourceMetadata, OAuthRequest, OAuthResponse, validateToken } from '@silkweave/auth'
import { Action, AdapterFactory, SilkweaveContext, SilkweaveError, SilkweaveOptions, toolResponse } from '@silkweave/core'
import { createLogger } from '@silkweave/logger'
import { capitalCase, pascalCase } from 'change-case'
import cors from 'cors'
import { randomUUID } from 'crypto'
import express, { Express, Request, Response } from 'express'
import { readFile } from 'fs/promises'
import { Server } from 'http'
import { AsyncLocalStorage } from 'node:async_hooks'
import { SideloadResource } from '../util/sideload.js'

const authStorage = new AsyncLocalStorage<AuthInfo>()

export interface HttpAdapterOptions extends CreateMcpExpressAppOptions {
  host: string
  port: number
  auth?: AuthConfig
}

function mountOAuthRoutes(app: Express, auth: AuthConfig): Set<string> {
  const provider = auth.provider!
  const callbackPath = auth.callbackPath ?? '/auth/callback'

  const toOAuthReq = (req: Request): OAuthRequest => ({
    method: req.method,
    url: new URL(req.url, `${req.protocol}://${req.get('host')}`),
    headers: Object.fromEntries(Object.entries(req.headers).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v])),
    body: req.body as Record<string, string> | undefined
  })

  const sendOAuth = (res: Response, oauthRes: OAuthResponse) => {
    for (const [key, value] of Object.entries(oauthRes.headers)) { res.header(key, value) }
    if (oauthRes.body) {
      res.status(oauthRes.status).send(typeof oauthRes.body === 'string' ? oauthRes.body : JSON.stringify(oauthRes.body))
    } else {
      res.status(oauthRes.status).end()
    }
  }

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

function mountAuthMiddleware(app: Express, auth: AuthConfig, oauthPaths: Set<string>) {
  app.use(async (req: Request, res: Response, next: (err?: unknown) => void) => {
    if (req.path.startsWith('/.well-known/') || oauthPaths.has(req.path)) { return next() }
    const result = await validateToken(req.headers.authorization, auth)
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

function createMcpServer(options: SilkweaveOptions, actions: Action[], context: SilkweaveContext): McpServer {
  const server = new McpServer({
    name: options.name,
    description: options.description,
    version: options.version
  }, {
    capabilities: { tools: {}, logging: {} }
  })

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
            params: {
              progress,
              total,
              message,
              progressToken: extra._meta.progressToken
            }
          })
        }
      })
      const currentAuth = authStorage.getStore()
      return action.run(input, context.fork({ logger, extra, ...(currentAuth ? { auth: currentAuth } : {}) })).then((result) => {
        return toolResponse(result)
      }).catch((error) => {
        if (error instanceof SilkweaveError) {
          return toolResponse({ success: false, code: error.code, name: error.name, message: error.message }, true)
        } else if (error instanceof Error) {
          return toolResponse({ success: false, name: error.name, message: error.message, stack: error.stack }, true)
        } else {
          return toolResponse({ success: false, name: 'Unknown Error', message: 'An unknown error occurred', error }, true)
        }
      })
    })
  }

  return server
}

function mountMcpTransport(
  app: Express,
  transports: Record<string, StreamableHTTPServerTransport>,
  createServer: () => McpServer
) {
  app.post('/mcp', async (req: Request, res: Response) => {
    const sessionId = req.headers['mcp-session-id'] as string | undefined
    try {
      let transport: StreamableHTTPServerTransport
      if (sessionId && transports[sessionId]) {
        transport = transports[sessionId]
      } else if (isInitializeRequest(req.body)) {
        const eventStore = new InMemoryEventStore()
        transport = new StreamableHTTPServerTransport({
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
        await createServer().connect(transport)
        await transport.handleRequest(req, res, req.body)
        return
      } else {
        res.status(404).json({
          jsonrpc: '2.0',
          error: { code: -32_000, message: 'Session not found' },
          id: null
        })
        return
      }
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

export const http: AdapterFactory<HttpAdapterOptions> = ({ host, port, auth, ...mcpOptions }) => {
  return (options, baseContext) => {
    const context = baseContext.fork({ adapter: 'http' })
    const app = createMcpExpressApp({ ...mcpOptions, host })
    app.use(cors({ exposedHeaders: ['WWW-Authenticate', 'Mcp-Session-Id', 'Last-Event-Id', 'Mcp-Protocol-Version'], origin: '*' }))

    if (auth?.authorizationServers?.length && auth.resourceUrl) {
      app.get('/.well-known/oauth-protected-resource', (_req: Request, res: Response) => {
        const metadata = generateProtectedResourceMetadata(auth.resourceUrl!, auth.authorizationServers!)
        res.json(metadata)
      })
    }

    const oauthPaths = auth?.provider ? mountOAuthRoutes(app, auth) : new Set<string>()

    if (auth) {
      mountAuthMiddleware(app, auth, oauthPaths)
    }

    const transports: Record<string, StreamableHTTPServerTransport> = {}
    let mountedActions: Action[] = []

    app.get('/resource/:id', async (req: Request, res: Response) => {
      const id = req.params.id
      if (!id || typeof id !== 'string') { throw new Error('Invalid ID') }
      const resourceMeta: SideloadResource = JSON.parse(await readFile(`resources/${id}.json`, 'utf-8'))
      const buffer = await readFile(`resources/${id}`)
      res.status(200)
      res.header('Content-Type', resourceMeta.contentType)
      res.send(buffer)
    })

    mountMcpTransport(app, transports, () => createMcpServer(options, mountedActions, context))

    let httpServer: Server | undefined
    return {
      context,
      start: async (actions) => {
        mountedActions = actions
        httpServer = app.listen(port, host, (error) => {
          if (error) {
            console.error('Failed to start server:', error)
            process.exit(1)
          }
          console.log(`MCP Streamable HTTP Server listening on http://${host}:${port}/mcp`)
        })
      },
      stop: async () => {
        if (httpServer) {
          await new Promise<void>((resolve, reject) => {
            return httpServer!.close((err) => {
              if (err) {
                reject(err)
              } else {
                resolve()
              }
            })
          })
        }
        httpServer = undefined
      }
    }
  }
}
