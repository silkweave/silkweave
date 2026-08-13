import { AuthConfig, generateProtectedResourceMetadata, resolveProtectedResourceMetadata, toResourceRequest } from '@silkweave/auth'
import { SilkweaveContext } from '@silkweave/core'
import { type RequestHandler } from 'express'

/**
 * Handler for `GET /.well-known/oauth-protected-resource` (RFC 9728). Returns
 * the resource server's metadata pointing at the configured authorization
 * servers. Requires `auth.resourceUrl` and a non-empty `auth.authorizationServers`.
 *
 * With a string `auth.resourceUrl` the document is precomputed at mount time,
 * exactly as before. With a `ResourceResolver` it is resolved per request from
 * the path suffix (`…/oauth-protected-resource/<tenant>`), and an unrecognized
 * sub-resource is a 404 - mount this on a wildcard route in that case.
 */
export function protectedResourceMetadata(auth: AuthConfig, context?: SilkweaveContext): RequestHandler {
  if (!auth.resourceUrl || !auth.authorizationServers?.length) {
    throw new Error('@silkweave/mcp protectedResourceMetadata(): auth.resourceUrl and auth.authorizationServers are required')
  }

  if (typeof auth.resourceUrl === 'string') {
    const metadata = generateProtectedResourceMetadata(auth.resourceUrl, auth.authorizationServers, auth.requiredScopes)
    return (_req, res) => { res.json(metadata) }
  }

  if (!context) {
    throw new Error('@silkweave/mcp protectedResourceMetadata(): a SilkweaveContext is required when auth.resourceUrl is a resolver')
  }

  return (req, res) => {
    const request = toResourceRequest(context.fork({ request: req }))
    const metadata = request && resolveProtectedResourceMetadata(auth, request, context)
    if (!metadata) {
      res.status(404).json({ error: 'not_found', error_description: 'Unknown protected resource' })
      return
    }
    res.json(metadata)
  }
}
