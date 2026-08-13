import { SilkweaveContext } from '@silkweave/core'
import type { AuthInfo, OAuthProvider } from './provider/types.js'

export type { AuthInfo } from './provider/types.js'

export type VerifyToken = (token: string, context: SilkweaveContext) => Promise<AuthInfo | undefined>

/** Normalized view of the inbound request a `ResourceResolver` sees. */
export interface ResourceRequest {
  /** Absolute request URL as the adapter saw it (origin from Host / forwarded headers). */
  url: URL
  headers: Record<string, string | undefined>
}

/**
 * Maps an inbound request to the canonical identifier of the protected resource
 * it addresses, or `undefined` when the URL is not a recognized resource.
 *
 * MUST return the canonical form - its own configured origin plus the matched
 * path - and never echo `request.url.origin`. A spoofed `Host` header would
 * otherwise steer the advertised metadata URL and the expected audience. Use
 * `pathResolver()` to get that property structurally.
 *
 * Synchronous by design: this is shape/identity mapping (a regex over a
 * pathname). Async policy - "does this tenant exist?", "may this client have
 * it?" - belongs in the authorization server's `allowedResources`, which runs on
 * the token path where an await is already free.
 */
export type ResourceResolver = (request: ResourceRequest, context: SilkweaveContext) => string | undefined

export interface AuthConfig {
  verifyToken: VerifyToken
  required?: boolean
  /**
   * The protected resource this server is. A `string` is one static resource
   * (the common case). A `ResourceResolver` maps each request to its own
   * resource identifier, so one server can front N resources - per-tenant MCP
   * endpoints behind a single authorization server - each with its own token
   * audience, so a token minted for tenant A is rejected at tenant B.
   */
  resourceUrl?: string | ResourceResolver
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
