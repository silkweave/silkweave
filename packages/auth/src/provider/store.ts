export interface AuthCodeData {
  clientId: string
  redirectUri: string
  codeChallenge: string
  codeChallengeMethod: string
  scopes: string[]
  upstreamAccessToken: string
  upstreamIdToken?: string
  email?: string
  sub?: string
  expiresAt: number
}

export interface PendingAuthData {
  clientId: string
  redirectUri: string
  codeChallenge: string
  codeChallengeMethod: string
  scope: string
  clientState: string
  resource?: string
  expiresAt: number
}

export interface ClientRegistration {
  clientId: string
  clientSecret: string
  redirectUris: string[]
  clientName?: string
  createdAt: number
}

export interface RefreshTokenData {
  clientId: string
  scopes: string[]
  email?: string
  sub?: string
  expiresAt: number
}

export interface OAuthStore {
  saveAuthCode(code: string, data: AuthCodeData): Promise<void>
  getAuthCode(code: string): Promise<AuthCodeData | undefined>
  deleteAuthCode(code: string): Promise<void>

  savePendingAuth(state: string, data: PendingAuthData): Promise<void>
  getPendingAuth(state: string): Promise<PendingAuthData | undefined>
  deletePendingAuth(state: string): Promise<void>

  savePkceVerifier(state: string, verifier: string): Promise<void>
  getPkceVerifier(state: string): Promise<string | undefined>
  deletePkceVerifier(state: string): Promise<void>

  saveClient(clientId: string, data: ClientRegistration): Promise<void>
  getClient(clientId: string): Promise<ClientRegistration | undefined>

  saveRefreshToken(token: string, data: RefreshTokenData): Promise<void>
  getRefreshToken(token: string): Promise<RefreshTokenData | undefined>
  deleteRefreshToken(token: string): Promise<void>
}
