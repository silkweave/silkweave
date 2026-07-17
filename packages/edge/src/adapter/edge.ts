import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import { AuthConfig, generateProtectedResourceMetadata, OAuthRequest, OAuthResponse, validateToken } from '@silkweave/auth'
import { Action, AdapterGenerator, OnToolCall, SilkweaveContext, SilkweaveOptions, validateActionDisposition } from '@silkweave/core'
import { emitInvalidArguments, filterErrorResponse, registerTools, rpcInfo, type FilterActions } from '@silkweave/mcp/tools'

export interface EdgeAdapterOptions {
  enableJsonResponse?: boolean
  auth?: AuthConfig
  path?: string
  /**
   * DNS-rebinding protection. When `allowedHosts`/`allowedOrigins` are set the
   * transport validates the inbound `Host`/`Origin` against them (browser pages
   * on other origins are then rejected). Off by default to preserve the
   * any-origin behavior; set these when the server is reachable from a browser.
   */
  allowedHosts?: string[]
  allowedOrigins?: string[]
  /**
   * `Access-Control-Allow-Origin` value. Defaults to `'*'`. Set to a specific
   * origin to stop reflecting every origin (pair with `allowedOrigins`).
   */
  corsOrigin?: string
  /**
   * Per-request tool filter, applied before `registerTools()` on every POST
   * (the stateless transport recomputes the tool list per request). See
   * `FilterActions` for the request stand-in (`headers`/`url`/`method`/
   * `toolName`) and error semantics (a throw surfaces as its
   * `SilkweaveError.statusCode` or 500 - never an empty tool list).
   */
  filterActions?: FilterActions
  /** Telemetry hook invoked once per tool call (fire-and-forget). */
  onToolCall?: OnToolCall
}

export interface EdgeAdapter {
  adapter: AdapterGenerator
  handler: (request: Request) => Promise<Response>
  GET: (request: Request) => Promise<Response>
  POST: (request: Request) => Promise<Response>
  DELETE: (request: Request) => Promise<Response>
}

function buildCorsHeaders(origin: string): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': '*',
    'Access-Control-Max-Age': '86400'
  }
}

/** A malformed OAuth request (e.g. non-JSON body) - surfaced as a 400, not a 500. */
class OAuthRequestError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message)
    this.name = 'OAuthRequestError'
  }
}

/** Transport DNS-rebinding config, enabled only when host/origin allow-lists are set. */
function dnsRebindingOptions(options: EdgeAdapterOptions): Record<string, unknown> {
  if (!options.allowedHosts && !options.allowedOrigins) { return {} }
  return {
    enableDnsRebindingProtection: true,
    ...(options.allowedHosts ? { allowedHosts: options.allowedHosts } : {}),
    ...(options.allowedOrigins ? { allowedOrigins: options.allowedOrigins } : {})
  }
}

/** Map a thrown handler error to a JSON error Response (400 for a bad OAuth body, else 500). */
function edgeErrorResponse(error: unknown, corsHeaders: Record<string, string>): Response {
  if (error instanceof OAuthRequestError) {
    return new Response(JSON.stringify({ error: error.code, error_description: error.message }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
  console.error('edge handler error:', error)
  return new Response(JSON.stringify({ jsonrpc: '2.0', error: { code: -32_603, message: 'Internal server error' }, id: null }), {
    status: 500,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  })
}

async function parseOAuthRequest(url: URL, request: Request): Promise<OAuthRequest> {
  let body: Record<string, string> | undefined
  if (request.method === 'POST') {
    const contentType = request.headers.get('content-type') ?? ''
    const text = await request.text()
    if (contentType.includes('json')) {
      try {
        body = JSON.parse(text)
      } catch {
        throw new OAuthRequestError('invalid_request', 'Request body is not valid JSON')
      }
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

function oauthResponseToResponse(oauthRes: OAuthResponse): Response {
  const responseBody = oauthRes.body
    ? (typeof oauthRes.body === 'string' ? oauthRes.body : JSON.stringify(oauthRes.body))
    : null
  return new Response(responseBody, { status: oauthRes.status, headers: oauthRes.headers })
}

async function routeOAuth(
  url: URL,
  request: Request,
  provider: NonNullable<AuthConfig['provider']>,
  callbackPath: string
): Promise<Response> {
  const oauthReq = await parseOAuthRequest(url, request)
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
  return oauthResponseToResponse(oauthRes)
}

export function edge(options: EdgeAdapterOptions = {}): EdgeAdapter {
  const mcpPath = options.path ?? '/mcp'
  const callbackPath = options.auth?.callbackPath ?? '/auth/callback'
  const CORS_HEADERS = buildCorsHeaders(options.corsOrigin ?? '*')

  let _actions: Action[] = []
  let _options: SilkweaveOptions | null = null
  let _context: SilkweaveContext | null = null
  let _readyResolve: () => void
  let _readyReject: (error: unknown) => void
  const _ready = new Promise<void>((resolve, reject) => {
    _readyResolve = resolve
    _readyReject = reject
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

  const handleRequestInner = async (request: Request): Promise<Response> => {
    const url = new URL(request.url)

    // Fast rejection - no async work, no allocations for unknown paths
    if (!validPaths.has(url.pathname)) {
      return new Response('Not Found', { status: 404 })
    }

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 200, headers: CORS_HEADERS })
    }

    // Protected resource metadata (RFC 9728)
    if (url.pathname === '/.well-known/oauth-protected-resource') {
      const metadata = generateProtectedResourceMetadata(options.auth!.resourceUrl!, options.auth!.authorizationServers!, options.auth!.requiredScopes)
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
        return routeOAuth(url, request, options.auth!.provider!, callbackPath)
      }
    }

    // MCP transport (stateless): only POST carries JSON-RPC. A standing-stream
    // GET or a session-teardown DELETE has no session to act on - and the SDK's
    // GET handler would open an SSE stream that never closes, hanging the request
    // on serverless runtimes (e.g. Cloudflare Workers). Answer them with 405, which
    // the Streamable HTTP spec explicitly permits for servers without a GET stream.
    if (request.method !== 'POST') {
      return new Response('Method Not Allowed', {
        status: 405,
        headers: { ...CORS_HEADERS, Allow: 'POST' }
      })
    }

    // wait for silkweave().start() to complete
    await _ready

    // JSON-RPC batching was removed from the MCP spec (2025-06-18). A batch also
    // defeats per-request filterActions (rpcInfo reflects only the first message
    // while the transport would execute every entry), so reject batches before
    // dispatch. Parsed once here and reused by the filter below.
    const rawBody: unknown = await request.clone().json().catch(() => undefined)
    if (Array.isArray(rawBody)) {
      return new Response(
        JSON.stringify({ jsonrpc: '2.0', error: { code: -32_600, message: 'JSON-RPC batch requests are not supported' }, id: null }),
        { status: 400, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } }
      )
    }

    let requestContext = _context!
    if (options.auth) {
      const result = await validateToken(request.headers.get('authorization'), options.auth, _context!.fork({ request }))
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

    let activeActions = _actions
    if (options.filterActions) {
      try {
        activeActions = await options.filterActions(_actions, {
          headers: Object.fromEntries(request.headers.entries()),
          url: request.url,
          ...rpcInfo(rawBody)
        })
      } catch (error) {
        const mapped = filterErrorResponse(error, rawBody)
        return new Response(JSON.stringify(mapped.body), {
          status: mapped.status,
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
        })
      }
    }

    // Emit-only: the SDK rejects an invalid-arguments tools/call before the
    // handler (and its telemetry emit) ever runs, so surface it here. The
    // request still proceeds to the SDK for its native rejection.
    await emitInvalidArguments(rawBody, activeActions, requestContext, options.onToolCall)

    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: options.enableJsonResponse,
      ...dnsRebindingOptions(options)
    })

    const server = new McpServer({
      name: _options!.name,
      description: _options!.description,
      version: _options!.version
    }, {
      capabilities: { tools: {}, logging: {} }
    })

    registerTools(server, activeActions, requestContext, { onToolCall: options.onToolCall })

    await server.connect(transport)
    return transport.handleRequest(request)
  }

  // Top-level guard: any throw (malformed OAuth body, a boot-failure rejection
  // from `await _ready`, an unexpected error) becomes a JSON error Response
  // rather than an opaque host 500 / unhandled rejection on the serverless runtime.
  const handleRequest = async (request: Request): Promise<Response> => {
    try {
      return await handleRequestInner(request)
    } catch (error) {
      return edgeErrorResponse(error, CORS_HEADERS)
    }
  }

  const adapter: AdapterGenerator = (silkweaveOptions: SilkweaveOptions, baseContext: SilkweaveContext) => {
    _options = silkweaveOptions
    _context = baseContext.fork({ adapter: 'edge' })
    return {
      context: _context,
      start: async (actions) => {
        try {
          actions.forEach(validateActionDisposition)
          _actions = actions
          _readyResolve()
        } catch (error) {
          // Reject `_ready` so awaiting handlers get a 500 instead of hanging
          // forever, then rethrow so the builder's start() rejects too.
          _readyReject(error)
          throw error
        }
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
