import type { OAuthProvider } from './provider/types.js'

export interface AuthInfo {
  token: string
  clientId?: string
  scopes?: string[]
  expiresAt?: number
  [key: string]: unknown
}

export type VerifyToken = (token: string) => Promise<AuthInfo | undefined>

export interface AuthConfig {
  verifyToken: VerifyToken
  required?: boolean
  resourceUrl?: string
  authorizationServers?: string[]
  requiredScopes?: string[]
  provider?: OAuthProvider
  callbackPath?: string
}
