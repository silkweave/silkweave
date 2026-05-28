import { AuthConfig, generateProtectedResourceMetadata } from '@silkweave/auth'
import { type RequestHandler } from 'express'

/**
 * Handler for `GET /.well-known/oauth-protected-resource` (RFC 9728). Returns
 * the resource server's metadata pointing at the configured authorization
 * servers. Requires `auth.resourceUrl` and a non-empty `auth.authorizationServers`.
 */
export function protectedResourceMetadata(auth: AuthConfig): RequestHandler {
  if (!auth.resourceUrl || !auth.authorizationServers?.length) {
    throw new Error('@silkweave/mcp protectedResourceMetadata(): auth.resourceUrl and auth.authorizationServers are required')
  }
  const metadata = generateProtectedResourceMetadata(auth.resourceUrl, auth.authorizationServers)
  return (_req, res) => { res.json(metadata) }
}
