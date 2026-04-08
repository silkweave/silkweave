import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import { AuthConfig, generateProtectedResourceMetadata, OAuthRequest, validateToken } from '@silkweave/auth'
import { Action, AdapterGenerator, SilkweaveContext, SilkweaveError, SilkweaveOptions, toolResponse } from '@silkweave/core'
import { createLogger } from '@silkweave/logger'
import { capitalCase, pascalCase } from 'change-case'

export interface VercelAdapterOptions {
  enableJsonResponse?: boolean
  auth?: AuthConfig
  path?: string
}

export interface VercelAdapter {
  adapter: AdapterGenerator
  handler: (request: Request) => Promise<Response>
  GET: (request: Request) => Promise<Response>
  POST: (request: Request) => Promise<Response>
  DELETE: (request: Request) => Promise<Response>
}

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Max-Age': '86400'
}

export function vercel(options: VercelAdapterOptions = {}): VercelAdapter {
  const mcpPath = options.path ?? '/mcp'
  const callbackPath = options.auth?.callbackPath ?? '/auth/callback'

  let _actions: Action[] = []
  let _options: SilkweaveOptions | null = null
  let _context: SilkweaveContext | null = null
  let _readyResolve: () => void
  const _ready = new Promise<void>((resolve) => {
    _readyResolve = resolve
  })

  // Pre-compute valid paths for fast rejection of bogus requests
  const validPaths = new Set<string>([mcpPath])
  if (options.auth?.authorizationServers?.length && options.auth.resourceUrl) {
    validPaths.add('/.well-known/oauth-protected-resource')
  }
  if (options.auth?.provider) {
    validPaths.add('/.well-known/oauth-authorization-server')
    validPaths.add('/authorize')
    validPaths.add(callbackPath)
    validPaths.add('/token')
    validPaths.add('/register')
  }

  // OAuth path → allowed methods (built once, not per-request)
  const oauthPaths: Record<string, string[]> | null = options.auth?.provider
    ? {
      '/.well-known/oauth-authorization-server': ['GET'],
      '/authorize': ['GET'],
      [callbackPath]: ['GET'],
      '/token': ['POST'],
      '/register': ['POST']
    }
    : null

  const handleRequest = async (request: Request): Promise<Response> => {
    const url = new URL(request.url)

    // Fast rejection — no async work, no allocations for unknown paths
    if (!validPaths.has(url.pathname)) {
      return new Response('Not Found', { status: 404 })
    }

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 200, headers: CORS_HEADERS })
    }

    // Protected resource metadata (RFC 9728)
    if (url.pathname === '/.well-known/oauth-protected-resource') {
      const metadata = generateProtectedResourceMetadata(options.auth!.resourceUrl!, options.auth!.authorizationServers!)
      return new Response(JSON.stringify(metadata), {
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json', 'Cache-Control': 'max-age=3600' }
      })
    }

    // OAuth provider routes
    if (oauthPaths) {
      const methods = oauthPaths[url.pathname]
      if (methods) {
        if (!methods.includes(request.method)) {
          return new Response('Method not allowed', { status: 405 })
        }
        return handleOAuth(url, request, options.auth!.provider!)
      }
    }

    // MCP transport — wait for silkweave().start() to complete
    await _ready

    let requestContext = _context!
    if (options.auth) {
      const result = await validateToken(request.headers.get('authorization'), options.auth)
      if (result.error) {
        return new Response(JSON.stringify(result.error.body), {
          status: result.error.statusCode,
          headers: result.error.headers
        })
      }
      if (result.auth) {
        requestContext = _context!.fork({ auth: result.auth })
      }
    }

    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: options.enableJsonResponse
    })

    const server = new McpServer({
      name: _options!.name,
      description: _options!.description,
      version: _options!.version
    }, {
      capabilities: { tools: {}, logging: {} }
    })

    for (const action of _actions) {
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
        return action.run(input, requestContext.fork({ logger, extra })).then((result) => {
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

    await server.connect(transport)
    return transport.handleRequest(request)
  }

  async function handleOAuth(url: URL, request: Request, provider: NonNullable<AuthConfig['provider']>): Promise<Response> {
    const toOAuthReq = async (): Promise<OAuthRequest> => {
      let body: Record<string, string> | undefined
      if (request.method === 'POST') {
        const contentType = request.headers.get('content-type') ?? ''
        const text = await request.text()
        if (contentType.includes('json')) {
          body = JSON.parse(text)
        } else {
          body = Object.fromEntries(new URLSearchParams(text))
        }
      }
      return {
        method: request.method,
        url,
        headers: Object.fromEntries(request.headers.entries()),
        body
      }
    }

    const oauthReq = await toOAuthReq()
    let oauthRes
    if (url.pathname === '/.well-known/oauth-authorization-server') {
      oauthRes = provider.metadata()
    } else if (url.pathname === '/authorize') {
      oauthRes = await provider.authorize(oauthReq)
    } else if (url.pathname === callbackPath) {
      oauthRes = await provider.callback(oauthReq)
    } else if (url.pathname === '/token') {
      oauthRes = await provider.token(oauthReq)
    } else {
      oauthRes = await provider.register(oauthReq)
    }

    const responseBody = oauthRes.body ? (typeof oauthRes.body === 'string' ? oauthRes.body : JSON.stringify(oauthRes.body)) : null
    return new Response(responseBody, { status: oauthRes.status, headers: oauthRes.headers })
  }

  const adapter: AdapterGenerator = (silkweaveOptions: SilkweaveOptions, baseContext: SilkweaveContext) => {
    _options = silkweaveOptions
    _context = baseContext.fork({ adapter: 'vercel' })
    return {
      context: _context,
      start: async (actions) => {
        _actions = actions
        _readyResolve()
      },
      stop: async () => {
        _actions = []
      }
    }
  }

  return {
    adapter,
    handler: handleRequest,
    GET: handleRequest,
    POST: handleRequest,
    DELETE: handleRequest
  }
}
