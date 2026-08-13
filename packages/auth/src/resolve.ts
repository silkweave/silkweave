import { SilkweaveContext } from '@silkweave/core'
import { AuthConfig, ResourceRequest, ResourceResolver } from './types.js'

/** RFC 9728 well-known path segment for protected resource metadata. */
export const PROTECTED_RESOURCE_WELL_KNOWN = '/.well-known/oauth-protected-resource'

/**
 * Canonical resource URI per RFC 8707 §2: absolute, no fragment, lowercased
 * scheme and host, default port stripped, and a bare origin's trailing slash
 * stripped. Returns `undefined` when the value is not an absolute URI.
 *
 * The trailing slash is the classic bug: clients ship `new URL(resource)`
 * stringifications, so a bare origin arrives as `https://host/` while configs
 * say `https://host`. Path case is preserved (tenant ids are case-sensitive),
 * as are trailing slashes on non-root paths - the resolver and the
 * authorization server simply have to agree.
 */
export function normalizeResourceUri(value: string): string | undefined {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return undefined
  }
  if (url.hash) {
    return undefined
  }
  url.hash = ''
  // `new URL` already lowercases scheme + host and strips the default port.
  const serialized = url.toString()
  return url.pathname === '/' && !url.search ? serialized.replace(/\/$/, '') : serialized
}

/**
 * RFC 9728 path-insertion form of a resource's metadata URL:
 * `https://h/a/b` -> `https://h/.well-known/oauth-protected-resource/a/b`.
 * This is what the MCP SDK probes when no `WWW-Authenticate` challenge is in hand.
 */
export function protectedResourceMetadataUrl(resource: string): string {
  const url = new URL(resource)
  const path = url.pathname === '/' ? '' : url.pathname
  return `${url.origin}${PROTECTED_RESOURCE_WELL_KNOWN}${path}`
}

/** The path suffix a resource contributes to its insertion-form well-known URL. */
export function resourcePathSuffix(resource: string): string {
  const { pathname } = new URL(resource)
  return pathname === '/' ? '' : pathname
}

type HeaderBag = Record<string, string | string[] | undefined>

function headerValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

function flattenHeaders(headers: HeaderBag): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {}
  for (const [key, value] of Object.entries(headers)) {
    out[key.toLowerCase()] = headerValue(value)
  }
  return out
}

/**
 * Normalize the adapter-forked `request` on the context into a `ResourceRequest`.
 * Handles the four shapes silkweave's adapters fork: a Fetch `Request`
 * (edge / trpc-fetch), an Express request, a Fastify request, and a bare
 * `IncomingMessage` (trpc standalone: path-only `url` plus a `host` header).
 *
 * Returns `undefined` when no usable request is present - a resolver cannot run
 * without one, and the caller treats that as "resource unresolved".
 */
export function toResourceRequest(context: SilkweaveContext): ResourceRequest | undefined {
  const request = context.getOptional<unknown>('request')
  if (!request || typeof request !== 'object') {
    return undefined
  }

  // Fetch Request: absolute url, Headers instance.
  const fetchLike = request as { url?: unknown; headers?: unknown }
  if (typeof fetchLike.url === 'string' && fetchLike.headers instanceof Headers) {
    let url: URL
    try {
      url = new URL(fetchLike.url)
    } catch {
      return undefined
    }
    const headers: Record<string, string | undefined> = {}
    fetchLike.headers.forEach((value, key) => {
      headers[key.toLowerCase()] = value
    })
    return { url, headers }
  }

  // Node-shaped: Express / Fastify / IncomingMessage.
  const nodeLike = request as {
    url?: unknown
    originalUrl?: unknown
    protocol?: unknown
    headers?: unknown
  }
  const rawHeaders =
    nodeLike.headers && typeof nodeLike.headers === 'object' ? flattenHeaders(nodeLike.headers as HeaderBag) : {}

  const path =
    typeof nodeLike.originalUrl === 'string'
      ? nodeLike.originalUrl
      : typeof nodeLike.url === 'string'
        ? nodeLike.url
        : undefined
  if (path === undefined) {
    return undefined
  }

  // Already absolute (some frameworks hand over a full URL).
  try {
    return { url: new URL(path), headers: rawHeaders }
  } catch {
    // Path-only: reconstruct the origin from the request's own view of it.
    // Behind a proxy this needs the host framework's forwarded-header handling
    // (Express `trust proxy`, Fastify `trustProxy`) to be accurate - which is
    // why nothing security-bearing may echo this origin. See `ResourceResolver`.
    const forwardedProto = headerValue(rawHeaders['x-forwarded-proto'])?.split(',')[0]?.trim()
    const protocol = typeof nodeLike.protocol === 'string' ? nodeLike.protocol : (forwardedProto ?? 'http')
    const host = rawHeaders['x-forwarded-host']?.split(',')[0]?.trim() ?? rawHeaders.host
    if (!host) {
      return undefined
    }
    try {
      return { url: new URL(path, `${protocol}://${host}`), headers: rawHeaders }
    } catch {
      return undefined
    }
  }
}

/**
 * Resolve the protected resource identifier for this request. A `string`
 * `resourceUrl` passes through unchanged; a `ResourceResolver` is invoked with
 * the normalized request.
 */
export function resolveResourceUrl(config: AuthConfig, context: SilkweaveContext): string | undefined {
  const configured = config.resourceUrl
  if (configured === undefined) {
    return undefined
  }
  if (typeof configured === 'string') {
    return configured
  }
  const request = toResourceRequest(context)
  if (!request) {
    return undefined
  }
  return configured(request, context)
}

export interface PathResolverOptions {
  /**
   * The canonical origin every resolved identifier is built from. The request's
   * own origin is never used, so a spoofed `Host` cannot steer the advertised
   * metadata URL or the expected audience.
   */
  origin: string
  /**
   * Map a request pathname to the resource's path (leading slash included, e.g.
   * `/yoexoexl`), `''` for the origin itself, or `undefined` when the path is
   * not a resource. A `RegExp` is shorthand for "first capture group wins".
   */
  match: RegExp | ((pathname: string, request: ResourceRequest) => string | undefined)
}

/**
 * Build a `ResourceResolver` that is canonical by construction: identifiers are
 * always `origin` plus a matched path, never anything derived from the inbound
 * request's origin.
 *
 * ```ts
 * resourceUrl: pathResolver({ origin: 'https://mcp.example.com', match: /^\/([a-z]{8})$/ })
 * ```
 *
 * Paths that do not match resolve to `undefined`, which behaves exactly as an
 * unset `resourceUrl` does: a challenge without `resource_metadata` and no
 * default audience check. Return `''` from a function `match` to map a request
 * to the origin resource itself.
 */
export function pathResolver(options: PathResolverOptions): ResourceResolver {
  const origin = normalizeResourceUri(options.origin) ?? options.origin
  const { match } = options
  return (request) => {
    let path: string | undefined
    if (typeof match === 'function') {
      path = match(request.url.pathname, request)
    } else {
      const captured = match.exec(request.url.pathname)?.[1]
      path = captured === undefined ? undefined : `/${captured}`
    }
    if (path === undefined) {
      return undefined
    }
    return path === '' ? origin : `${origin}${path.startsWith('/') ? path : `/${path}`}`
  }
}
