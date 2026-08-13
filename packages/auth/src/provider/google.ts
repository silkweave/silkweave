import { AuthConfig, ResourceResolver } from '../types.js'
import { AllowedResources, createOAuthProxy } from './proxy.js'
import { OAuthStore } from './store.js'

export interface GoogleOAuthOptions {
  clientId: string
  clientSecret: string
  /**
   * Authorization-server identity: `iss`, the endpoint base, and the default
   * audience. Stays a single string even for a multi-resource deployment - the
   * AS identity does not fragment. Use `resolveResource` to front N resources.
   */
  resourceUrl: string
  /**
   * Per-request protected-resource resolution for the emitted `AuthConfig`
   * (see `AuthConfig.resourceUrl`). Overrides only the resource-server side;
   * `resourceUrl` remains the AS identity and the `authorization_servers` entry.
   */
  resolveResource?: ResourceResolver
  /** RFC 8707 resource indicators this AS will mint an `aud` for. See `AllowedResources`. */
  allowedResources?: AllowedResources
  redirectUris: string[]
  requiredScopes?: string[]
  callbackPath?: string
  signingKey?: string
  tokenTtl?: number
  store?: OAuthStore
}

export function google(options: GoogleOAuthOptions): AuthConfig {
  const provider = createOAuthProxy({
    authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    userinfoUrl: 'https://openidconnect.googleapis.com/v1/userinfo',
    clientId: options.clientId,
    clientSecret: options.clientSecret,
    resourceUrl: options.resourceUrl,
    redirectUris: options.redirectUris,
    requiredScopes: options.requiredScopes ?? ['openid', 'email'],
    callbackPath: options.callbackPath,
    signingKey: options.signingKey,
    tokenTtl: options.tokenTtl,
    store: options.store,
    allowedResources: options.allowedResources
  })

  return {
    verifyToken: (token) => provider.verifyToken(token),
    required: true,
    resourceUrl: options.resolveResource ?? options.resourceUrl,
    authorizationServers: [options.resourceUrl],
    provider,
    callbackPath: options.callbackPath ?? '/auth/callback'
  }
}
