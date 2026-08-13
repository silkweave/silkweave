import { SilkweaveContext } from '@silkweave/core'
import { PROTECTED_RESOURCE_WELL_KNOWN, resourcePathSuffix } from './resolve.js'
import { AuthConfig, ResourceRequest } from './types.js'

export interface ProtectedResourceMetadata {
  resource: string
  authorization_servers: string[]
  scopes_supported?: string[]
  bearer_methods_supported?: string[]
}

export function generateProtectedResourceMetadata(
  resourceUrl: string,
  authorizationServers: string[],
  scopesSupported?: string[]
): ProtectedResourceMetadata {
  return {
    resource: resourceUrl,
    authorization_servers: authorizationServers,
    ...(scopesSupported?.length ? { scopes_supported: scopesSupported } : {}),
    bearer_methods_supported: ['header']
  }
}

/**
 * Resolve the RFC 9728 document for a well-known request, for adapters serving a
 * `ResourceResolver`-backed `AuthConfig`. `request.url.pathname` is the full
 * request path; the well-known prefix is stripped and the remainder replayed
 * through the resolver as the as-if resource request, so a resolver never needs
 * to know the well-known prefix exists.
 *
 * Returns `undefined` when the path is not a well-known metadata request, when
 * the resolver does not recognize the sub-resource, or when the resolver's
 * answer addresses a different path than the one requested - all of which the
 * caller turns into a 404. Comparing **pathnames** (rather than whole URLs)
 * keeps this proxy-robust: no `trust proxy` dependency on the metadata path,
 * while RFC 9728 §3.3's client-side identity check still catches a resolver
 * returning an origin the client is not talking to.
 */
export function resolveProtectedResourceMetadata(
  auth: AuthConfig,
  request: ResourceRequest,
  context: SilkweaveContext
): ProtectedResourceMetadata | undefined {
  const resolver = auth.resourceUrl
  if (typeof resolver !== 'function' || !auth.authorizationServers?.length) {
    return undefined
  }

  const { pathname } = request.url
  if (!pathname.startsWith(PROTECTED_RESOURCE_WELL_KNOWN)) {
    return undefined
  }
  const suffix = pathname.slice(PROTECTED_RESOURCE_WELL_KNOWN.length)
  if (suffix !== '' && !suffix.startsWith('/')) {
    return undefined
  }

  const asIfUrl = new URL(request.url.toString())
  asIfUrl.pathname = suffix === '' ? '/' : suffix

  const resource = resolver({ url: asIfUrl, headers: request.headers }, context)
  if (!resource) {
    return undefined
  }
  if (resourcePathSuffix(resource) !== suffix) {
    return undefined
  }

  return generateProtectedResourceMetadata(resource, auth.authorizationServers, auth.requiredScopes)
}
