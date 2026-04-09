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
  provider?: OAuthProvider
  callbackPath?: string
}
