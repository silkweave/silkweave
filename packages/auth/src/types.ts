import { SilkweaveContext } from '@silkweave/core'
import type { AuthInfo, OAuthProvider } from './provider/types.js'

export type { AuthInfo } from './provider/types.js'

export type VerifyToken = (token: string, context: SilkweaveContext) => Promise<AuthInfo | undefined>

export interface AuthConfig {
  verifyToken: VerifyToken
  required?: boolean
  resourceUrl?: string
  authorizationServers?: string[]
  requiredScopes?: string[]
  /**
   * Expected token audience (RFC 8707 Resource Indicators / SEP-2352). When a
   * verified token carries an `aud` claim, it must include one of these values -
   * this is the resource-server confused-deputy defence (reject a token minted
   * for a *different* resource). Defaults to `resourceUrl`; set `false` to skip.
   */
  audience?: string | string[] | false
  /**
   * Expected token issuer (RFC 9207 / SEP-2468). When set, a verified token whose
   * `iss` claim differs is rejected, binding the credential to the issuing
   * authorization server.
   */
  issuer?: string
  provider?: OAuthProvider
  callbackPath?: string
}
