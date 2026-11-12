export interface AuthCodeData {
  clientId: string
  redirectUri: string
  codeChallenge: string
  codeChallengeMethod: string
  scopes: string[]
  /** Upstream IdP tokens - set by `createOAuthProxy`, absent for `createOAuthServer`. */
  upstreamAccessToken?: string
  upstreamIdToken?: string
  email?: string
  sub?: string
  /** RFC 8707 resource indicator captured at /authorize, carried into the mint. */
  resource?: string
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
  /**
   * The audience this token chain was minted for. Re-minted verbatim on refresh
   * so rotation cannot become a lateral move to a different resource. Absent on
   * records predating multi-resource support - those refresh into
   * default-audience tokens, exactly what they already were.
   */
  resource?: string
  /**
   * Stable id of the approved connection (the grant), minted at the code
   * exchange and kept across every rotation. Carried in the access token as
   * `grant_id`. Absent on records minted before 7.2.
   */
  grantId?: string
  /** When the grant was approved (epoch seconds). */
  createdAt?: number
  /**
   * Set when this token has been rotated (epoch seconds). The record is kept,
   * not deleted, so a later replay is recognized: within the grace window it
   * rotates again, after it the whole grant is revoked via `revokeGrant`.
   */
  rotatedAt?: number
  /** Absolute expiry (epoch seconds) - carried over unchanged by rotation. */
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
  /**
   * Delete every refresh token belonging to a grant (all rotations). Called when
   * a rotated refresh token is replayed after the grace window - the chain is
   * treated as stolen. Optional: without it only the replayed token is deleted.
   * Stores that list grants per user (e.g. a "Connected apps" page) also call
   * this for user-initiated revocation; pair it with `isGrantActive` so the
   * grant's current access token stops working before it expires.
   */
  revokeGrant?(grantId: string): Promise<void>
}
