/**
 * Opaque, JSON-serialisable app context bound to a grant at `approve()` - e.g.
 * the consent's principal id, a user auth epoch, the consent time. The provider
 * never interprets it: it is carried verbatim from the authorization code onto
 * the grant's first refresh record, copied on every rotation, and handed to
 * `isGrantActive` at code redemption and on every refresh. It is NOT in the
 * access token (clients can read JWTs), so `isGrantActive` gets no context on
 * `verifyToken` - look it up by `grantId` in your own grant record instead.
 */
export type GrantContext = Record<string, unknown>

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
  /**
   * Opaque app context captured at `approve()` (e.g. the consent's principal id
   * and auth epoch), carried verbatim. See `GrantContext`.
   */
  context?: GrantContext
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
   * Opaque app context captured at `approve()` (e.g. the consent's principal id
   * and auth epoch), carried verbatim. See `GrantContext`.
   */
  context?: GrantContext
  /**
   * Set when this token has been rotated (epoch seconds). The record is kept,
   * not deleted, so a later replay is recognized: within the grace window it
   * returns the same successor again (`next`), after it the whole grant is
   * revoked via `revokeGrant`.
   */
  rotatedAt?: number
  /**
   * The successor refresh token, encrypted with a key derived from THIS
   * (presented) token - opaque to the store, readable only by someone holding
   * the raw predecessor. Lets a reuse inside the grace window return the same
   * successor instead of branching the chain. Set together with `rotatedAt`.
   */
  next?: string
  /** Absolute expiry (epoch seconds) - carried over unchanged by rotation. */
  expiresAt: number
}

/** The rotation a refresh grant tries to record on the presented token. */
export interface RefreshRotation {
  rotatedAt: number
  next: string
  grantId: string
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
   * Revoke a grant: record a durable tombstone (see `isGrantRevoked`) FIRST, then
   * delete every refresh token belonging to it (all rotations). Called when a
   * rotated refresh token is replayed after the grace window - the chain is
   * treated as stolen. Optional: without it only the replayed token is deleted.
   * Stores that list grants per user (e.g. a "Connected apps" page) also call
   * this for user-initiated revocation; pair it with `isGrantActive` so the
   * grant's current access token stops working before it expires.
   */
  revokeGrant?(grantId: string): Promise<void>

  // ---- Atomic operations (optional, strongly recommended) -------------------
  // Without them the server falls back to get-then-write sequences, which are
  // correct for a single request at a time but race under concurrency (two
  // parallel redemptions of one code, two approvals of one consent request,
  // two first rotations of one refresh token). Implement them with your
  // backend's atomic primitives (`DELETE ... RETURNING`, Redis `GETDEL`/`SET NX`,
  // a transaction). The memory, JSON and Redis stores implement them.

  /** Atomically read and delete an authorization code (single-use redemption). */
  takeAuthCode?(code: string): Promise<AuthCodeData | undefined>
  /** Atomically read and delete a pending authorization (single-use consent / callback). */
  takePendingAuth?(state: string): Promise<PendingAuthData | undefined>
  /**
   * Compare-and-set rotation: record `rotation` on the token's record only if it
   * has not been rotated yet. Returns the record as stored afterwards - with
   * THIS rotation if it won, or with the earlier winner's `rotatedAt`/`next` if
   * another refresh got there first. `undefined` if the token does not exist.
   */
  rotateRefreshToken?(token: string, rotation: RefreshRotation): Promise<RefreshTokenData | undefined>
  /**
   * Whether `revokeGrant` has been called for this grant. Revocation must be
   * durable (a tombstone that outlives the grant's tokens), so a refresh that
   * was in flight while the grant was revoked cannot resurrect it: the server
   * re-checks this after saving a successor and deletes it if revoked.
   */
  isGrantRevoked?(grantId: string): Promise<boolean>
}
