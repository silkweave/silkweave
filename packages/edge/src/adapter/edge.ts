import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import {
  AuthConfig,
  generateProtectedResourceMetadata,
  OAuthRequest,
  OAuthResponse,
  PROTECTED_RESOURCE_WELL_KNOWN,
  resolveProtectedResourceMetadata,
  toResourceRequest,
  validateToken
} from '@silkweave/auth'
import {
  Action,
  AdapterGenerator,
  OnToolCall,
  SilkweaveContext,
  SilkweaveOptions,
  Skill,
  SkillDefinition,
  validateActionDisposition
} from '@silkweave/core'
import {
  emitInvalidArguments,
  filterErrorResponse,
  MARKETPLACE_PATH,
  prepareSkills,
  registerTools,
  rpcInfo,
  type FilterActions,
  type SkillServing,
  type SkillsMarketplaceOptions
} from '@silkweave/mcp/tools'

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
  /**
   * Extra paths that also serve the MCP transport, beyond `path` (default
   * `/mcp`). For a multi-resource server these are the per-tenant connector
   * URLs, each mapped by the `auth.resourceUrl` resolver to its own protected
   * resource and token audience. Edge has no router, so this is either an exact
   * path list or a predicate that composes with the consumer's own routing.
   */
  transportPaths?: string[] | ((pathname: string) => boolean)
  /** Telemetry hook invoked once per tool call (fire-and-forget). */
  onToolCall?: OnToolCall
  /**
   * Agent skills to serve: `skill://` file resources + `ListSkills`/`GetSkill`
   * tools + a server-instructions pointer. Requires `@silkweave/skills`
   * (optional peer). On a filesystem-less runtime (Workers) use
   * `defineSkill({ files })` with inline content.
   */
  skills?: (Skill | SkillDefinition)[]
  /** EXPERIMENTAL: also serve the SEP-2640 draft extension (`skills/list`/`skills/get` + capability). */
  skillsExtension?: boolean
  /**
   * Serve a Claude Code plugin marketplace at `/.claude-plugin/marketplace.json`
   * listing every served skill that carries an `npmPackage` (packed with
   * `silkweave skills pack`, published to npm). Served unauthenticated - the
   * document only points at already-public npm packages. Requires `skills`.
   */
  skillsMarketplace?: SkillsMarketplaceOptions
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
  constructor(
    public readonly code: string,
    message: string
  ) {
    super(message)
    this.name = 'OAuthRequestError'
  }
}

/** Transport DNS-rebinding config, enabled only when host/origin allow-lists are set. */
function dnsRebindingOptions(options: EdgeAdapterOptions): Record<string, unknown> {
  if (!options.allowedHosts && !options.allowedOrigins) {
    return {}
  }
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
  return new Response(
    JSON.stringify({ jsonrpc: '2.0', error: { code: -32_603, message: 'Internal server error' }, id: null }),
    {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    }
  )
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
    ? typeof oauthRes.body === 'string'
      ? oauthRes.body
      : JSON.stringify(oauthRes.body)
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

/**
 * `GET /.claude-plugin/marketplace.json` - the Claude Code plugin marketplace.
 * Public by construction (it only points at npm-published packages), so it is
 * served before the auth check, like `/.well-known/`.
 */
function marketplaceResponse(
  request: Request,
  serving: SkillServing | undefined,
  corsHeaders: Record<string, string>
): Response {
  if (request.method !== 'GET') {
    return new Response('Method Not Allowed', { status: 405, headers: { ...corsHeaders, Allow: 'GET' } })
  }
  return new Response(serving?.marketplace, {
    headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'max-age=300' }
  })
}

/**
 * `GET /.well-known/oauth-protected-resource[/<resource path>]` - RFC 9728
 * metadata. A string `resourceUrl` serves one precomputable document at the bare
 * path; a `ResourceResolver` serves the insertion-form path per request, 404ing
 * on an unrecognized sub-resource.
 */
function protectedResourceResponse(
  auth: AuthConfig,
  request: Request,
  context: SilkweaveContext,
  corsHeaders: Record<string, string>
): Response {
  const metadata =
    typeof auth.resourceUrl === 'string'
      ? generateProtectedResourceMetadata(auth.resourceUrl, auth.authorizationServers!, auth.requiredScopes)
      : resolveProtectedResourceMetadata(auth, toResourceRequest(context.fork({ request }))!, context)

  if (!metadata) {
    return new Response(JSON.stringify({ error: 'not_found', error_description: 'Unknown protected resource' }), {
      status: 404,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }

  return new Response(JSON.stringify(metadata), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'max-age=3600' }
  })
}

/** Validate the bearer token; an error becomes the Response, success forks `auth` into the context. */
async function authenticateRequest(
  request: Request,
  auth: AuthConfig | undefined,
  context: SilkweaveContext
): Promise<{ response: Response } | { context: SilkweaveContext }> {
  if (!auth) {
    return { context }
  }
  const result = await validateToken(request.headers.get('authorization'), auth, context.fork({ request }))
  if (result.error) {
    return {
      response: new Response(JSON.stringify(result.error.body), {
        status: result.error.statusCode,
        headers: result.error.headers
      })
    }
  }
  return { context: result.auth ? context.fork({ auth: result.auth }) : context }
}

/** Apply the per-request `filterActions`; a throw maps to its statusCode/500, never an empty tool list. */
async function applyActionFilter(
  filter: FilterActions | undefined,
  combined: Action[],
  request: Request,
  rawBody: unknown,
  corsHeaders: Record<string, string>
): Promise<{ response: Response } | { actions: Action[] }> {
  if (!filter) {
    return { actions: combined }
  }
  try {
    return {
      actions: await filter(combined, {
        headers: Object.fromEntries(request.headers.entries()),
        url: request.url,
        ...rpcInfo(rawBody)
      })
    }
  } catch (error) {
    const mapped = filterErrorResponse(error, rawBody)
    return {
      response: new Response(JSON.stringify(mapped.body), {
        status: mapped.status,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }
  }
}

/**
 * Mint the per-request server, gating the skill surface (resources +
 * instructions) on the skill actions having survived the per-request filter -
 * see SkillServing.visible.
 */
function createEdgeMcpServer(
  options: SilkweaveOptions,
  actions: Action[],
  context: SilkweaveContext,
  onToolCall: OnToolCall | undefined,
  serving: SkillServing | undefined
): McpServer {
  const skillsVisible = serving?.visible(actions) ?? false
  const server = new McpServer(
    {
      name: options.name,
      description: options.description,
      version: options.version
    },
    {
      capabilities: { tools: {}, logging: {}, ...(skillsVisible ? { resources: {} } : {}) },
      ...(skillsVisible && serving ? { instructions: serving.instructions } : {})
    }
  )
  registerTools(server, actions, context, { onToolCall })
  if (skillsVisible) {
    serving?.register(server)
  }
  return server
}

/** How a request path relates to the routes this adapter serves. */
interface EdgePathMatch {
  /** The path is one this adapter serves at all (else: 404 before any async work). */
  known: boolean
  /** An RFC 9728 insertion-form sub-resource document (resolver configs only). */
  isResolverMetadata: boolean
}

interface EdgePathMatchers {
  validPaths: Set<string>
  extraTransportPaths: string[]
  matchTransportPath?: (pathname: string) => boolean
  resolverMetadata: boolean
}

/** Classify a request path. Pure and allocation-free, so unknown paths cost nothing. */
function matchEdgePath(pathname: string, m: EdgePathMatchers): EdgePathMatch {
  const isResolverMetadata = m.resolverMetadata && pathname.startsWith(`${PROTECTED_RESOURCE_WELL_KNOWN}/`)
  const isTransport = m.extraTransportPaths.includes(pathname) || m.matchTransportPath?.(pathname) === true
  return { known: m.validPaths.has(pathname) || isResolverMetadata || isTransport, isResolverMetadata }
}

/** Dispatch the OAuth provider routes; `undefined` when this path is not one of them. */
function matchOAuthRoute(
  oauthPaths: Record<string, string[]> | null,
  url: URL,
  request: Request,
  auth: AuthConfig,
  callbackPath: string
): Promise<Response> | Response | undefined {
  const methods = oauthPaths?.[url.pathname]
  if (!methods) {
    return undefined
  }
  if (!methods.includes(request.method)) {
    return new Response('Method not allowed', { status: 405 })
  }
  return routeOAuth(url, request, auth.provider!, callbackPath)
}

export function edge(options: EdgeAdapterOptions = {}): EdgeAdapter {
  const mcpPath = options.path ?? '/mcp'
  const callbackPath = options.auth?.callbackPath ?? '/auth/callback'
  const CORS_HEADERS = buildCorsHeaders(options.corsOrigin ?? '*')

  let _actions: Action[] = []
  let _serving: SkillServing | undefined
  let _options: SilkweaveOptions | null = null
  let _context: SilkweaveContext | null = null
  let _readyResolve: () => void
  let _readyReject: (error: unknown) => void
  const _ready = new Promise<void>((resolve, reject) => {
    _readyResolve = resolve
    _readyReject = reject
  })
  // A boot failure is surfaced through start() and every awaiting handler; the
  // bare rejection must not double as an unhandled rejection when no request
  // is in flight.
  _ready.catch(() => {
    /* surfaced via start() / per-request await */
  })

  // Pre-compute valid paths for fast rejection of bogus requests
  const extraTransportPaths = Array.isArray(options.transportPaths) ? options.transportPaths : []
  const matchTransportPath = typeof options.transportPaths === 'function' ? options.transportPaths : undefined
  const validPaths = new Set<string>([mcpPath, ...extraTransportPaths])
  if (options.skillsMarketplace) {
    validPaths.add(MARKETPLACE_PATH)
  }
  // A string resourceUrl has exactly one document; a resolver serves a family of
  // insertion-form paths, matched by prefix below rather than by exact set.
  const resolverMetadata =
    Boolean(options.auth?.authorizationServers?.length) && typeof options.auth?.resourceUrl === 'function'
  if (options.auth?.authorizationServers?.length && options.auth.resourceUrl) {
    validPaths.add(PROTECTED_RESOURCE_WELL_KNOWN)
  }
  if (options.auth?.provider) {
    validPaths.add('/.well-known/oauth-authorization-server')
    validPaths.add('/authorize')
    validPaths.add(callbackPath)
    validPaths.add('/token')
    validPaths.add('/register')
  }

  const pathMatchers: EdgePathMatchers = { validPaths, extraTransportPaths, matchTransportPath, resolverMetadata }

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

    // Fast rejection - no async work, no allocations for unknown paths.
    const { known, isResolverMetadata } = matchEdgePath(url.pathname, pathMatchers)
    if (!known) {
      return new Response('Not Found', { status: 404 })
    }

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 200, headers: CORS_HEADERS })
    }

    // Claude Code plugin marketplace - public, so it sits before the auth check.
    if (options.skillsMarketplace && url.pathname === MARKETPLACE_PATH) {
      await _ready
      return marketplaceResponse(request, _serving, CORS_HEADERS)
    }

    // Protected resource metadata (RFC 9728)
    if (url.pathname === PROTECTED_RESOURCE_WELL_KNOWN || isResolverMetadata) {
      // A resolver needs the per-request context, which only exists once the
      // adapter has been registered; the string form needs nothing.
      if (resolverMetadata) {
        await _ready
      }
      return protectedResourceResponse(options.auth!, request, _context!, CORS_HEADERS)
    }

    // OAuth provider routes
    const oauthResponse = matchOAuthRoute(oauthPaths, url, request, options.auth!, callbackPath)
    if (oauthResponse) {
      return oauthResponse
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
    const rawBody: unknown = await request
      .clone()
      .json()
      .catch(() => undefined)
    if (Array.isArray(rawBody)) {
      return new Response(
        JSON.stringify({
          jsonrpc: '2.0',
          error: { code: -32_600, message: 'JSON-RPC batch requests are not supported' },
          id: null
        }),
        { status: 400, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } }
      )
    }

    const authed = await authenticateRequest(request, options.auth, _context!)
    if ('response' in authed) {
      return authed.response
    }
    const requestContext = authed.context

    const combined = _serving ? [..._actions, ..._serving.actions] : _actions
    const filtered = await applyActionFilter(options.filterActions, combined, request, rawBody, CORS_HEADERS)
    if ('response' in filtered) {
      return filtered.response
    }
    const activeActions = filtered.actions

    // Emit-only: the SDK rejects an invalid-arguments tools/call before the
    // handler (and its telemetry emit) ever runs, so surface it here. The
    // request still proceeds to the SDK for its native rejection.
    await emitInvalidArguments(rawBody, activeActions, requestContext, options.onToolCall)

    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: options.enableJsonResponse,
      ...dnsRebindingOptions(options)
    })
    const server = createEdgeMcpServer(_options!, activeActions, requestContext, options.onToolCall, _serving)
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
          _serving = await prepareSkills(options.skills, {
            extension: options.skillsExtension,
            ...(options.skillsMarketplace
              ? {
                  marketplace: {
                    ...options.skillsMarketplace,
                    name: options.skillsMarketplace.name ?? silkweaveOptions.name
                  }
                }
              : {})
          })
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
