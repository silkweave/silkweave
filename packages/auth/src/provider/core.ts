// Shared authorization-server core for `createOAuthProxy` (upstream IdP) and
// `createOAuthServer` (the app is the IdP). Everything a client talks to -
// metadata, dynamic client registration, CIMD, /authorize validation, PKCE, the
// token endpoint (code + refresh grants) and access-token verification - lives
// here. The two providers differ only in how a validated /authorize request
// becomes an authenticated subject: the proxy round-trips an upstream IdP, the
// server hands the browser to the app's consent page.
//
// Internal module: not re-exported from the package index.

import { randomBytes, randomUUID } from 'crypto'
import { SignJWT, jwtVerify } from 'jose'
import { normalizeResourceUri } from '../resolve.js'
import { createMemoryStore } from '../store/memory-store.js'
import { assertSafeMetadataUrl } from './ssrf.js'
import {
  AuthCodeData,
  ClientRegistration,
  OAuthStore,
  GrantContext,
  PendingAuthData,
  RefreshRotation,
  RefreshTokenData
} from './store.js'
import { AuthInfo, OAuthRequest, OAuthResponse } from './types.js'
import { matchRedirectUri, matchRegisteredRedirectUri } from './uri.js'

/**
 * RFC 8707 resource indicators this authorization server will mint an `aud` for,
 * beyond `resourceUrl` itself: exact identifiers, or a predicate (async is fine -
 * tenant existence can hit a store). Unset keeps pre-5.1 behavior, where the
 * indicator is ignored and every token is minted for `resourceUrl`.
 *
 * **`aud` is not membership.** This server will mint `aud: …/tenantA` for any
 * authenticated user who asks, including one with no rights in tenant A. The
 * indicator says where a token may be *presented*, never what its subject may
 * *do* there. Per-tenant authorization stays the resource server's job on every
 * call - a consumer treating "aud matches my tenant" as an access grant has
 * built a privilege escalation.
 *
 * Note the predicate runs on every `verifyToken`, so a store-backed check is a
 * hit per bearer validation: cache it, and be aware the store's availability
 * becomes the token path's availability.
 */
export type AllowedResources = string[] | ((resource: string) => boolean | Promise<boolean>)

/** The grant a token belongs to, as handed to `isGrantActive`. */
export interface GrantRef {
  /** Stable id of the approved connection, kept across refresh-token rotation. */
  grantId: string
  /** The authenticated subject (user) the grant was approved for. */
  sub: string
  /** The OAuth client the grant was issued to. */
  clientId: string
  /**
   * The `context` passed to `approve()` (createOAuthServer). Present at code
   * redemption and on refresh; always `undefined` on `verifyToken` (the access
   * token does not carry it) - look it up by `grantId` there.
   */
  context?: GrantContext
}

/**
 * Per-call grant check, run after JWT verification on every `verifyToken` AND on
 * every refresh grant - so revoking a grant (or the user behind it) stops both
 * the current access token and the refresh chain, without waiting for `exp`.
 * Return `false` to reject. Tokens that carry no grant id (minted before 7.2)
 * are rejected while this hook is configured - fail closed.
 */
export type IsGrantActive = (grant: GrantRef) => boolean | Promise<boolean>

/** Configuration shared by both providers. */
export interface AuthorizationServerConfig {
  /** Authorization-server identity: `iss`, the endpoint base, and the default audience. */
  resourceUrl: string
  /** Allowed client redirect URI patterns (`*` per URL component, see `matchRedirectUri`). */
  redirectUris: string[]
  /** HS256 signing key. A random key is generated when unset, so tokens die with the process. */
  signingKey?: string | Uint8Array
  /** Access-token lifetime in seconds. Default 3600. */
  tokenTtl?: number
  /** Refresh-token absolute lifetime in seconds. Default 30 days. Rotation never extends it. */
  refreshTokenTtl?: number
  /**
   * Seconds after rotation during which the previous refresh token is still
   * honored (it rotates again into another successor). Covers clients that
   * refresh concurrently from several processes. Default 30. After the window a
   * replayed refresh token is treated as stolen: the whole grant is revoked
   * (`OAuthStore.revokeGrant`).
   */
  refreshGraceSeconds?: number
  store?: OAuthStore
  allowedResources?: AllowedResources
  isGrantActive?: IsGrantActive
}

/** The subject an approved authorization is bound to. */
export interface AuthorizationIdentity {
  sub?: string
  email?: string
  context?: GrantContext
}

/** A validated /authorize request, ready to be stored as pending. */
export interface ValidatedAuthorize {
  pending: PendingAuthData
  client: ClientRegistration
  /** Upstream-only passthrough (`access_type`), read by the proxy. */
  params: URLSearchParams
}

/** Reading a `resource` parameter that may arrive repeated (and so as an array). */
type ResourceParam = { ok: true; value?: string } | { ok: false }

export const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': '*'
}

const DEFAULT_REFRESH_TTL = 30 * 24 * 3600
const DEFAULT_GRACE = 30
const PENDING_TTL = 600

export function jsonResponse(
  status: number,
  body: Record<string, unknown>,
  headers: Record<string, string> = {}
): OAuthResponse {
  return { status, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS, ...headers }, body }
}

export function redirectResponse(url: string): OAuthResponse {
  return { status: 302, headers: { Location: url, ...CORS_HEADERS }, body: undefined }
}

export function errorResponse(status: number, error: string, description: string): OAuthResponse {
  return jsonResponse(status, { error, error_description: description })
}

/** 32 random bytes, base64url - for codes, pending ids, refresh tokens. */
export function randomToken(): string {
  return randomBytes(32).toString('base64url')
}

const nowSeconds = (): number => Date.now() / 1000

async function sha256Base64Url(value: string): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return Buffer.from(hash).toString('base64url')
}

async function verifyPkce(verifier: string, challenge: string): Promise<boolean> {
  return (await sha256Base64Url(verifier)) === challenge
}

/**
 * Read `resource` from a form body. Repeated params parse to arrays behind the
 * declared `Record<string, string>` (Express `urlencoded`), so anything that is
 * not a single string is rejected rather than stringified into garbage.
 */
function readBodyResource(body: Record<string, string>): ResourceParam {
  const raw: unknown = body.resource
  if (raw === undefined || raw === '') {
    return { ok: true }
  }
  if (typeof raw !== 'string') {
    return { ok: false }
  }
  const normalized = normalizeResourceUri(raw)
  return normalized ? { ok: true, value: normalized } : { ok: false }
}

/** Build the "may this AS mint for that resource?" check. The allow-list is the AS's, never the client's. */
function resourceChecker(config: AuthorizationServerConfig): (resource: string) => Promise<boolean> {
  const allowed = config.allowedResources
  const defaultResource = normalizeResourceUri(config.resourceUrl) ?? config.resourceUrl
  const exact = Array.isArray(allowed)
    ? new Set(allowed.map((value) => normalizeResourceUri(value) ?? value))
    : undefined
  return async (resource) => {
    if (resource === defaultResource) {
      return true
    }
    if (!allowed) {
      return false
    }
    if (exact) {
      return exact.has(resource)
    }
    return (allowed as (r: string) => boolean | Promise<boolean>)(resource)
  }
}

/** Shape a verified JWT payload into an `AuthInfo`. */
function authInfoFromPayload(token: string, payload: Record<string, unknown>): AuthInfo {
  const sub = typeof payload.sub === 'string' ? payload.sub : undefined
  return {
    token,
    // Historical field: the token subject (the user), kept for compatibility.
    // The OAuth client is `oauthClientId`.
    clientId: sub,
    sub,
    oauthClientId: typeof payload.client_id === 'string' ? payload.client_id : undefined,
    grantId: typeof payload.grant_id === 'string' ? payload.grant_id : undefined,
    scopes: typeof payload.scope === 'string' ? payload.scope.split(' ').filter(Boolean) : [],
    expiresAt: payload.exp as number | undefined,
    email: payload.email
  }
}

/** The authorization-server core both providers are built on. */
export interface AuthorizationCore {
  store: OAuthStore
  multiResource: boolean
  metadata(): OAuthResponse
  register(req: OAuthRequest): Promise<OAuthResponse>
  /** Validate an /authorize request (client, redirect, PKCE, resource). */
  validateAuthorize(req: OAuthRequest): Promise<ValidatedAuthorize | OAuthResponse>
  /** Mint an authorization code for a pending request and build the client redirect. */
  issueCode(
    pending: PendingAuthData,
    identity: AuthorizationIdentity,
    extra?: { upstreamAccessToken?: string; upstreamIdToken?: string }
  ): Promise<string>
  /** Build the client redirect carrying an authorization error. */
  errorRedirect(pending: PendingAuthData, error: string, description?: string): string
  token(req: OAuthRequest): Promise<OAuthResponse>
  verifyToken(token: string): Promise<AuthInfo | undefined>
}

/** Resolved configuration shared by the core's grant/verify functions. */
interface CoreContext {
  config: AuthorizationServerConfig
  opts: { scopesSupported?: string[] }
  store: OAuthStore
  tokenTtl: number
  refreshTtl: number
  grace: number
  multiResource: boolean
  isAllowedResource: (resource: string) => Promise<boolean>
  issuer: string
  defaultResource: string
  getSigningKey: () => Uint8Array
}

const ATOMIC_METHODS = [
  'takeAuthCode',
  'takePendingAuth',
  'rotateRefreshToken',
  'isGrantRevoked',
  'revokeGrant'
] as const

/** The concurrency-safe store operations a store does not implement. */
export function missingAtomicMethods(store: OAuthStore): string[] {
  return ATOMIC_METHODS.filter((method) => typeof store[method] !== 'function')
}

/** Say once, at construction, when a custom store lacks the concurrency-safe operations. */
function warnWeakStore(store: OAuthStore): void {
  const missing = missingAtomicMethods(store)
  if (missing.length > 0) {
    console.warn(
      `[silkweave/auth] OAuthStore lacks ${missing.join(', ')}: single-use codes/consent, refresh rotation and ` +
        'replay revocation fall back to non-atomic get-then-write sequences. See the OAuthStore docs.'
    )
  }
}

function createCoreContext(config: AuthorizationServerConfig, opts: { scopesSupported?: string[] }): CoreContext {
  let signingKey: Uint8Array | null = null
  if (config.store) {
    warnWeakStore(config.store)
  }
  const issuer = config.resourceUrl
  return {
    config,
    opts,
    store: config.store ?? createMemoryStore(),
    tokenTtl: config.tokenTtl ?? 3600,
    refreshTtl: config.refreshTokenTtl ?? DEFAULT_REFRESH_TTL,
    grace: config.refreshGraceSeconds ?? DEFAULT_GRACE,
    multiResource: config.allowedResources !== undefined,
    isAllowedResource: resourceChecker(config),
    issuer,
    defaultResource: normalizeResourceUri(issuer) ?? issuer,
    getSigningKey() {
      if (!signingKey) {
        signingKey =
          config.signingKey === undefined
            ? randomBytes(32)
            : typeof config.signingKey === 'string'
              ? new TextEncoder().encode(config.signingKey)
              : config.signingKey
      }
      return signingKey
    }
  }
}

async function signAccessToken(
  ctx: CoreContext,
  claims: {
    scopes: string[]
    email?: string
    sub?: string
    clientId: string
    grantId?: string
    audience?: string
  }
): Promise<string> {
  const now = Math.floor(Date.now() / 1000)
  return (
    new SignJWT({
      scope: claims.scopes.join(' '),
      email: claims.email,
      client_id: claims.clientId,
      ...(claims.grantId ? { grant_id: claims.grantId } : {})
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(claims.sub ?? claims.email ?? claims.clientId)
      .setIssuer(ctx.issuer)
      // The AS identity never fragments; only the audience follows the resource.
      .setAudience(claims.audience ?? ctx.issuer)
      .setIssuedAt(now)
      .setExpirationTime(now + ctx.tokenTtl)
      .sign(ctx.getSigningKey())
  )
}

/** Run the app's grant check. Fails closed for grant-less tokens when configured. */
async function grantActive(
  ctx: CoreContext,
  ref: { grantId?: string; sub?: string; clientId?: string; context?: GrantContext }
): Promise<boolean> {
  if (!ctx.config.isGrantActive) {
    return true
  }
  if (!ref.grantId || !ref.sub || !ref.clientId) {
    return false
  }
  try {
    const grant: GrantRef = { grantId: ref.grantId, sub: ref.sub, clientId: ref.clientId }
    if (ref.context !== undefined) {
      grant.context = ref.context
    }
    return (await ctx.config.isGrantActive(grant)) === true
  } catch (error) {
    // Fail closed with an OAuth error (or a rejected token), never a thrown endpoint.
    console.error('isGrantActive hook error:', error)
    return false
  }
}

async function readAuthorizeResource(
  ctx: CoreContext,
  params: URLSearchParams
): Promise<{ ok: true; value?: string } | { ok: false; response: OAuthResponse }> {
  if (!ctx.multiResource) {
    return { ok: true, value: params.get('resource') ?? undefined }
  }
  // RFC 8707 permits repeats; we deliberately support exactly one resource per
  // grant, so `aud` stays a single string and the token endpoint's equality
  // rule stays trivial. MCP clients send exactly one.
  const values = params.getAll('resource').filter((value) => value !== '')
  if (values.length > 1) {
    return { ok: false, response: errorResponse(400, 'invalid_target', 'Only one resource indicator is supported') }
  }
  if (values.length === 0) {
    return { ok: true }
  }
  const normalized = normalizeResourceUri(values[0])
  if (!normalized) {
    return { ok: false, response: errorResponse(400, 'invalid_target', 'Invalid resource indicator') }
  }
  if (!(await ctx.isAllowedResource(normalized))) {
    return { ok: false, response: errorResponse(400, 'invalid_target', 'Unknown or unsupported resource') }
  }
  return { ok: true, value: normalized }
}

async function resolveClient(ctx: CoreContext, clientId: string): Promise<ClientRegistration | OAuthResponse> {
  const existing = await ctx.store.getClient(clientId)
  if (existing) {
    return existing
  }
  if (!clientId.startsWith('https://')) {
    return errorResponse(400, 'invalid_client', 'Unknown client_id')
  }
  const safety = assertSafeMetadataUrl(clientId)
  if (!safety.ok) {
    return errorResponse(400, 'invalid_client', 'Client metadata URL is not allowed')
  }
  try {
    // SSRF hardening: block redirects (a public URL could 3xx to an internal
    // one) and cap the request time. See assertSafeMetadataUrl for coverage.
    const metaRes = await fetch(clientId, { redirect: 'manual', signal: AbortSignal.timeout(5000) })
    if (metaRes.status >= 300 && metaRes.status < 400) {
      return errorResponse(400, 'invalid_client', 'Client metadata document must not redirect')
    }
    if (!metaRes.ok) {
      return errorResponse(400, 'invalid_client', 'Failed to fetch client metadata document')
    }
    const meta = (await metaRes.json()) as Record<string, unknown>
    // CIMD: the document must name itself. A document served at one URL but
    // claiming another client_id is not that client's metadata.
    if (meta.client_id !== clientId) {
      return errorResponse(400, 'invalid_client', 'Client metadata client_id does not match its URL')
    }
    const metaRedirectUris = meta.redirect_uris as string[] | undefined
    if (!Array.isArray(metaRedirectUris) || metaRedirectUris.length === 0) {
      return errorResponse(400, 'invalid_client', 'Client metadata must include redirect_uris')
    }
    for (const uri of metaRedirectUris) {
      if (!matchRedirectUri(uri, ctx.config.redirectUris)) {
        return errorResponse(400, 'invalid_redirect_uri', `Redirect URI not allowed: ${uri}`)
      }
    }
    const client: ClientRegistration = {
      clientId,
      clientSecret: '',
      redirectUris: metaRedirectUris,
      clientName: typeof meta.client_name === 'string' ? meta.client_name : undefined,
      createdAt: nowSeconds()
    }
    await ctx.store.saveClient(clientId, client)
    return client
  } catch {
    return errorResponse(400, 'invalid_client', 'Failed to fetch client metadata document')
  }
}

async function register(ctx: CoreContext, req: OAuthRequest): Promise<OAuthResponse> {
  const body = req.body
  if (!body) {
    return errorResponse(400, 'invalid_request', 'Missing request body')
  }
  const redirectUris = body.redirect_uris
  if (!redirectUris) {
    return errorResponse(400, 'invalid_request', 'redirect_uris is required')
  }
  let uris: string[]
  try {
    uris = typeof redirectUris === 'string' ? JSON.parse(redirectUris) : redirectUris
  } catch {
    uris = [redirectUris]
  }
  if (!Array.isArray(uris) || uris.length === 0) {
    return errorResponse(400, 'invalid_request', 'redirect_uris must be a non-empty array')
  }
  for (const uri of uris) {
    if (typeof uri !== 'string' || !matchRedirectUri(uri, ctx.config.redirectUris)) {
      return errorResponse(400, 'invalid_redirect_uri', `Redirect URI not allowed: ${String(uri)}`)
    }
  }
  const clientName = typeof body.client_name === 'string' ? body.client_name : undefined
  const clientId = randomUUID()
  // Every client is public (PKCE, token_endpoint_auth_method 'none'): the token
  // endpoint authenticates nobody by secret, so none is minted.
  await ctx.store.saveClient(clientId, {
    clientId,
    clientSecret: '',
    redirectUris: uris,
    clientName,
    createdAt: nowSeconds()
  })
  return jsonResponse(201, {
    client_id: clientId,
    redirect_uris: uris,
    client_name: clientName,
    token_endpoint_auth_method: 'none',
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code']
  })
}

async function validateAuthorize(ctx: CoreContext, req: OAuthRequest): Promise<ValidatedAuthorize | OAuthResponse> {
  const params = req.url.searchParams
  const clientId = params.get('client_id')
  const redirectUri = params.get('redirect_uri')
  const codeChallenge = params.get('code_challenge')
  const codeChallengeMethod = params.get('code_challenge_method')

  const requestedResource = await readAuthorizeResource(ctx, params)
  if (!requestedResource.ok) {
    return requestedResource.response
  }
  if (params.get('response_type') !== 'code') {
    return errorResponse(400, 'unsupported_response_type', 'Only response_type=code is supported')
  }
  if (!clientId) {
    return errorResponse(400, 'invalid_request', 'client_id is required')
  }
  if (!redirectUri) {
    return errorResponse(400, 'invalid_request', 'redirect_uri is required')
  }
  if (!codeChallenge || codeChallengeMethod !== 'S256') {
    return errorResponse(400, 'invalid_request', 'PKCE with S256 is required')
  }
  const client = await resolveClient(ctx, clientId)
  if ('status' in client) {
    return client
  }
  // Exact match, except loopback redirects match on any port (RFC 8252 §7.3):
  // native clients bind whatever port is free at sign-in time.
  if (!matchRegisteredRedirectUri(redirectUri, client.redirectUris)) {
    return errorResponse(400, 'invalid_redirect_uri', 'redirect_uri does not match registered URIs')
  }
  return {
    client,
    params,
    pending: {
      clientId,
      redirectUri,
      codeChallenge,
      codeChallengeMethod,
      scope: params.get('scope') ?? '',
      clientState: params.get('state') ?? '',
      resource: requestedResource.value,
      expiresAt: nowSeconds() + PENDING_TTL
    }
  }
}

function clientRedirect(ctx: CoreContext, pending: PendingAuthData, values: Record<string, string>): string {
  const url = new URL(pending.redirectUri)
  for (const [key, value] of Object.entries(values)) {
    url.searchParams.set(key, value)
  }
  if (pending.clientState) {
    url.searchParams.set('state', pending.clientState)
  }
  // RFC 9207: name the issuer in the authorization response (mix-up defence).
  url.searchParams.set('iss', ctx.issuer)
  return url.toString()
}

async function issueCode(
  ctx: CoreContext,
  pending: PendingAuthData,
  identity: AuthorizationIdentity,
  extra: { upstreamAccessToken?: string; upstreamIdToken?: string } = {}
): Promise<string> {
  const code = randomToken()
  await ctx.store.saveAuthCode(code, {
    clientId: pending.clientId,
    redirectUri: pending.redirectUri,
    codeChallenge: pending.codeChallenge,
    codeChallengeMethod: pending.codeChallengeMethod,
    scopes: pending.scope.split(' ').filter(Boolean),
    ...extra,
    email: identity.email,
    // Resolve the subject ONCE and persist it: the access token's `sub`, the
    // refresh record and `isGrantActive` must all see the same value (an
    // email-only upstream identity used to verify but never refresh).
    sub: identity.sub ?? identity.email ?? pending.clientId,
    resource: ctx.multiResource ? pending.resource : undefined,
    context: identity.context,
    expiresAt: nowSeconds() + PENDING_TTL
  })
  return clientRedirect(ctx, pending, { code })
}

function errorRedirect(ctx: CoreContext, pending: PendingAuthData, error: string, description?: string): string {
  return clientRedirect(ctx, pending, description ? { error, error_description: description } : { error })
}

/** Atomic get+delete of an authorization code, falling back to get-then-delete. */
async function takeAuthCode(store: OAuthStore, code: string): Promise<AuthCodeData | undefined> {
  if (store.takeAuthCode) {
    return store.takeAuthCode(code)
  }
  const data = await store.getAuthCode(code)
  if (data) {
    await store.deleteAuthCode(code)
  }
  return data
}

/** Atomic get+delete of a pending authorization, falling back to get-then-delete. */
export async function takePendingAuth(store: OAuthStore, state: string): Promise<PendingAuthData | undefined> {
  if (!state) {
    return undefined
  }
  const data = store.takePendingAuth ? await store.takePendingAuth(state) : await store.getPendingAuth(state)
  if (data && !store.takePendingAuth) {
    await store.deletePendingAuth(state)
  }
  return data && data.expiresAt >= nowSeconds() ? data : undefined
}

/** Compare-and-set rotation, falling back to read-check-write. */
async function rotateRefreshToken(
  store: OAuthStore,
  token: string,
  current: RefreshTokenData,
  rotation: RefreshRotation
): Promise<RefreshTokenData | undefined> {
  if (store.rotateRefreshToken) {
    return store.rotateRefreshToken(token, rotation)
  }
  const latest = (await store.getRefreshToken(token)) ?? current
  if (latest.rotatedAt !== undefined) {
    return latest
  }
  const rotated = { ...latest, ...rotation }
  await store.saveRefreshToken(token, rotated)
  return rotated
}

/** AES-GCM key derived from the raw predecessor token - only its holder can read `next`. */
async function successorKey(token: string): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(token), 'HKDF', false, ['deriveKey'])
  return crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: new Uint8Array(0),
      info: new TextEncoder().encode('silkweave/refresh-next/v1')
    },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  )
}

async function sealSuccessor(token: string, successor: string): Promise<string> {
  const iv = randomBytes(12)
  const sealed = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    await successorKey(token),
    new TextEncoder().encode(successor)
  )
  return Buffer.concat([iv, Buffer.from(sealed)]).toString('base64url')
}

async function openSuccessor(token: string, next: string): Promise<string | undefined> {
  try {
    const raw = Buffer.from(next, 'base64url')
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: raw.subarray(0, 12) },
      await successorKey(token),
      raw.subarray(12)
    )
    return new TextDecoder().decode(plain)
  } catch {
    return undefined
  }
}

/** Revoked durably by the store (`revokeGrant` tombstone) or by the app (`isGrantActive`)? */
async function grantDead(
  ctx: CoreContext,
  data: { grantId?: string; sub?: string; clientId: string }
): Promise<boolean> {
  if (data.grantId && ctx.store.isGrantRevoked && (await ctx.store.isGrantRevoked(data.grantId))) {
    return true
  }
  return !(await grantActive(ctx, data))
}

async function accessTokenResponse(
  ctx: CoreContext,
  data: RefreshTokenData & { grantId: string },
  refreshToken: string
) {
  const accessToken = await signAccessToken(ctx, {
    scopes: data.scopes,
    email: data.email,
    sub: data.sub,
    clientId: data.clientId,
    grantId: data.grantId,
    audience: data.resource
  })
  return jsonResponse(200, {
    access_token: accessToken,
    token_type: 'Bearer',
    expires_in: ctx.tokenTtl,
    scope: data.scopes.join(' '),
    refresh_token: refreshToken
  })
}

async function mintPair(ctx: CoreContext, data: RefreshTokenData & { grantId: string }): Promise<OAuthResponse> {
  const refreshToken = randomToken()
  await ctx.store.saveRefreshToken(refreshToken, data)
  return accessTokenResponse(ctx, data, refreshToken)
}

async function authorizationCodeGrant(ctx: CoreContext, body: Record<string, string>): Promise<OAuthResponse> {
  const { code, redirect_uri: redirectUri, client_id: clientId, code_verifier: codeVerifier } = body
  if (!code || !codeVerifier || !clientId) {
    return errorResponse(400, 'invalid_request', 'Missing required parameters')
  }
  const requested = ctx.multiResource ? readBodyResource(body) : ({ ok: true } as ResourceParam)
  if (!requested.ok) {
    return errorResponse(400, 'invalid_target', 'Invalid resource indicator')
  }
  // Atomic single-use redemption: two parallel exchanges of one code must not
  // both mint (RFC 6749 §4.1.2).
  const authCode = await takeAuthCode(ctx.store, code)
  if (!authCode || authCode.expiresAt < nowSeconds()) {
    return errorResponse(400, 'invalid_grant', 'Invalid or expired authorization code')
  }
  if (authCode.clientId !== clientId) {
    return errorResponse(400, 'invalid_grant', 'client_id mismatch')
  }
  if (redirectUri && authCode.redirectUri !== redirectUri) {
    return errorResponse(400, 'invalid_grant', 'redirect_uri mismatch')
  }
  if (!(await verifyPkce(codeVerifier, authCode.codeChallenge))) {
    return errorResponse(400, 'invalid_grant', 'PKCE verification failed')
  }
  // The MCP spec has clients send `resource` on both the authorize and token
  // legs. Equality after normalization is the entire consistency rule - one
  // resource per grant, no subset semantics.
  if (requested.value !== undefined && authCode.resource !== undefined && requested.value !== authCode.resource) {
    return errorResponse(400, 'invalid_target', 'resource does not match the authorization request')
  }
  const effectiveResource = requested.value ?? authCode.resource
  // Re-check here, not only at /authorize: a client that omitted the indicator
  // on the authorize leg must not be able to smuggle one in at redemption.
  if (effectiveResource !== undefined && !(await ctx.isAllowedResource(effectiveResource))) {
    return errorResponse(400, 'invalid_target', 'Unknown or unsupported resource')
  }
  const now = nowSeconds()
  const data: RefreshTokenData & { grantId: string } = {
    clientId: authCode.clientId,
    scopes: authCode.scopes,
    email: authCode.email,
    sub: authCode.sub,
    resource: effectiveResource,
    grantId: randomUUID(),
    createdAt: now,
    expiresAt: Math.floor(now) + ctx.refreshTtl
  }
  if (authCode.context !== undefined) {
    data.context = authCode.context
  }
  // The grant check runs BEFORE the first mint too: a code approved before the
  // user (or their consent context) was revoked must not mint a live grant.
  if (!(await grantActive(ctx, data))) {
    return errorResponse(400, 'invalid_grant', 'Grant is not active')
  }
  return mintPair(ctx, data)
}

async function refreshTokenGrant(ctx: CoreContext, body: Record<string, string>): Promise<OAuthResponse> {
  const refreshToken = body.refresh_token
  if (!refreshToken) {
    return errorResponse(400, 'invalid_request', 'Missing refresh_token')
  }
  // Legacy mode ignores a `resource` in the token body entirely, as before.
  const requested = ctx.multiResource ? readBodyResource(body) : ({ ok: true } as ResourceParam)
  if (!requested.ok) {
    return errorResponse(400, 'invalid_target', 'Invalid resource indicator')
  }
  const tokenData = await ctx.store.getRefreshToken(refreshToken)
  if (!tokenData || tokenData.expiresAt < nowSeconds()) {
    return errorResponse(400, 'invalid_grant', 'Invalid or expired refresh token')
  }
  if (tokenData.grantId && ctx.store.isGrantRevoked && (await ctx.store.isGrantRevoked(tokenData.grantId))) {
    return errorResponse(400, 'invalid_grant', 'Grant has been revoked')
  }

  // Replay of an already-rotated token after the grace window: the token has
  // leaked - revoke the whole grant (RFC 9700 §4.14.2).
  if (pastGrace(ctx, tokenData.rotatedAt)) {
    return revokeReplayed(ctx, refreshToken, tokenData)
  }

  // A refresh token must not be a lateral move to a different audience. The
  // stored value was validated at mint, so equality is the whole rule here.
  // An absent stored `resource` means the chain was minted for the default
  // audience, so a client restating that resource is asking for what it
  // already has - the SDK sends `resource` on the refresh leg too.
  if (requested.value !== undefined && requested.value !== (tokenData.resource ?? ctx.defaultResource)) {
    return errorResponse(400, 'invalid_target', 'resource does not match the refresh token')
  }
  // Bind the refresh token to the presenting client. Public clients send
  // client_id in the body; a token presented by another client is rejected.
  if (body.client_id && body.client_id !== tokenData.clientId) {
    return errorResponse(400, 'invalid_grant', 'refresh_token was not issued to this client')
  }
  if (await grantDead(ctx, tokenData)) {
    return errorResponse(400, 'invalid_grant', 'Grant has been revoked')
  }

  // Records minted before 7.2 carry no grant id: adopt one at first rotation.
  const grantId = tokenData.grantId ?? randomUUID()
  const data: RefreshTokenData & { grantId: string } = { ...tokenData, grantId, rotatedAt: undefined, next: undefined }
  // Save the successor BEFORE publishing it on the parent: whatever `next` a
  // concurrent or grace-window reuse reads must already exist. The original
  // absolute expiry carries over, so rotation never extends a chain's life.
  const successor = randomToken()
  await ctx.store.saveRefreshToken(successor, data)

  // Rotate (OAuth 2.1 for public clients) with a compare-and-set: the first
  // refresh of this token records its successor (sealed under this token) and
  // keeps the record, so a later replay is recognized. A concurrent or
  // grace-window reuse gets the SAME successor back instead of a new branch -
  // every presenter of this token continues one chain, so a thief and the
  // legitimate client collide on the next rotation and trip replay detection.
  const stored = await rotateRefreshToken(ctx.store, refreshToken, tokenData, {
    rotatedAt: nowSeconds(),
    next: await sealSuccessor(refreshToken, successor),
    grantId
  })
  const winner = stored?.next ? await openSuccessor(refreshToken, stored.next) : undefined
  if (!stored || !winner) {
    await ctx.store.deleteRefreshToken(successor)
    return errorResponse(400, 'invalid_grant', 'Invalid or expired refresh token')
  }
  const won = winner === successor
  let issued: RefreshTokenData & { grantId: string } = data
  if (!won) {
    // Another refresh rotated first: drop ours. Everything below is decided
    // from the authoritative CAS result, never from our pre-CAS read.
    await ctx.store.deleteRefreshToken(successor)
    const lost = await continueWinnerChain(ctx, refreshToken, stored, winner)
    if ('status' in lost) {
      return lost
    }
    // The winner's grant id (it differs from ours for an adopted pre-7.2 grant).
    issued = { ...stored, grantId: stored.grantId ?? grantId, rotatedAt: undefined, next: undefined }
  }
  // A revocation that raced this refresh must win, on both paths: re-check
  // after the successor exists, so either revokeGrant deleted it or we see the
  // tombstone here.
  if (await grantDead(ctx, issued)) {
    if (won) {
      await ctx.store.deleteRefreshToken(successor)
    }
    return errorResponse(400, 'invalid_grant', 'Grant has been revoked')
  }
  return accessTokenResponse(ctx, issued, winner)
}

/**
 * Validate a CAS-losing (concurrent or grace-window) reuse against the stored
 * record: the parent's own grace window and expiry, and that the shared
 * successor has not itself been rotated yet. A stale retry whose successor
 * already moved on gets `invalid_grant` WITHOUT revoking (it is the tolerated
 * concurrency case, but must not receive an already-spent token); a reuse past
 * the parent's grace window is a replay and revokes the grant.
 */
async function continueWinnerChain(
  ctx: CoreContext,
  refreshToken: string,
  stored: RefreshTokenData,
  winner: string
): Promise<OAuthResponse | { ok: true }> {
  if (stored.expiresAt < nowSeconds()) {
    return errorResponse(400, 'invalid_grant', 'Invalid or expired refresh token')
  }
  if (pastGrace(ctx, stored.rotatedAt)) {
    return revokeReplayed(ctx, refreshToken, stored)
  }
  const successorRecord = await ctx.store.getRefreshToken(winner)
  if (!successorRecord || successorRecord.rotatedAt !== undefined) {
    return errorResponse(400, 'invalid_grant', 'Refresh token was already used')
  }
  return { ok: true }
}

/**
 * Has a rotated token left its grace window? `refreshGraceSeconds: 0` means
 * strict rotation: any reuse of a rotated token is past grace, even within
 * the same clock tick.
 */
function pastGrace(ctx: CoreContext, rotatedAt: number | undefined): boolean {
  if (rotatedAt === undefined) {
    return false
  }
  return ctx.grace <= 0 || nowSeconds() - rotatedAt > ctx.grace
}

/** A rotated token reused after the grace window: revoke the grant (or at least the token). */
async function revokeReplayed(
  ctx: CoreContext,
  refreshToken: string,
  tokenData: RefreshTokenData
): Promise<OAuthResponse> {
  if (tokenData.grantId && ctx.store.revokeGrant) {
    await ctx.store.revokeGrant(tokenData.grantId)
  } else {
    await ctx.store.deleteRefreshToken(refreshToken)
  }
  return errorResponse(400, 'invalid_grant', 'Refresh token was already used')
}

/**
 * Verify an access token minted by this server.
 *
 * Without `allowedResources` this keeps the historical double pin (issuer +
 * audience) verbatim. With it, the audience pin is replaced by a manual check
 * that is stricter than it looks: `jwtVerify`'s `audience` option *requires*
 * the claim, so dropping it would accept an `aud`-less token, which
 * `validateToken` treats as a pass. So require a single non-empty string and
 * check membership. Returning `aud`/`iss` is the load-bearing part: it makes
 * `validateToken`'s per-endpoint audience binding the confused-deputy defence.
 */
async function verifyToken(ctx: CoreContext, token: string): Promise<AuthInfo | undefined> {
  try {
    let info: AuthInfo
    if (!ctx.multiResource) {
      const { payload } = await jwtVerify(token, ctx.getSigningKey(), { issuer: ctx.issuer, audience: ctx.issuer })
      info = authInfoFromPayload(token, payload)
    } else {
      const { payload } = await jwtVerify(token, ctx.getSigningKey(), { issuer: ctx.issuer })
      const aud = payload.aud
      if (typeof aud !== 'string' || aud === '' || !(await ctx.isAllowedResource(aud))) {
        return undefined
      }
      info = {
        ...authInfoFromPayload(token, payload),
        aud,
        iss: typeof payload.iss === 'string' ? payload.iss : undefined
      }
    }
    const active = await grantActive(ctx, {
      grantId: info.grantId as string | undefined,
      sub: info.sub as string | undefined,
      clientId: info.oauthClientId as string | undefined
    })
    return active ? info : undefined
  } catch {
    return undefined
  }
}

function metadata(ctx: CoreContext): OAuthResponse {
  return jsonResponse(
    200,
    {
      issuer: ctx.issuer,
      authorization_endpoint: `${ctx.issuer}/authorize`,
      token_endpoint: `${ctx.issuer}/token`,
      registration_endpoint: `${ctx.issuer}/register`,
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['none'],
      authorization_response_iss_parameter_supported: true,
      client_id_metadata_document_supported: true,
      scopes_supported: ctx.opts.scopesSupported ?? []
    },
    { 'Cache-Control': 'max-age=3600' }
  )
}

function tokenEndpoint(ctx: CoreContext, req: OAuthRequest): Promise<OAuthResponse> {
  const body = req.body
  if (!body) {
    return Promise.resolve(errorResponse(400, 'invalid_request', 'Missing request body'))
  }
  if (body.grant_type === 'refresh_token') {
    return refreshTokenGrant(ctx, body)
  }
  if (body.grant_type !== 'authorization_code') {
    return Promise.resolve(
      errorResponse(400, 'unsupported_grant_type', 'Supported grant types: authorization_code, refresh_token')
    )
  }
  return authorizationCodeGrant(ctx, body)
}

export function createAuthorizationCore(
  config: AuthorizationServerConfig,
  opts: { scopesSupported?: string[] } = {}
): AuthorizationCore {
  const ctx = createCoreContext(config, opts)
  return {
    store: ctx.store,
    multiResource: ctx.multiResource,
    metadata: () => metadata(ctx),
    register: (req) => register(ctx, req),
    validateAuthorize: (req) => validateAuthorize(ctx, req),
    issueCode: (pending, identity, extra) => issueCode(ctx, pending, identity, extra),
    errorRedirect: (pending, error, description) => errorRedirect(ctx, pending, error, description),
    token: (req) => tokenEndpoint(ctx, req),
    verifyToken: (accessToken) => verifyToken(ctx, accessToken)
  }
}
