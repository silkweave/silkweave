import { AuthConfig } from '../types.js'
import { createOAuthProxy } from './proxy.js'
import { OAuthStore } from './store.js'

export interface GoogleOAuthOptions {
  clientId: string
  clientSecret: string
  resourceUrl: string
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
    store: options.store
  })

  return {
    verifyToken: (token) => provider.verifyToken(token),
    required: true,
    resourceUrl: options.resourceUrl,
    authorizationServers: [options.resourceUrl],
    provider,
    callbackPath: options.callbackPath ?? '/auth/callback'
  }
}
