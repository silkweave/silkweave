import { randomBytes, randomUUID } from 'crypto'
import { SignJWT, jwtVerify } from 'jose'
import { normalizeResourceUri } from '../resolve.js'
import { createMemoryStore } from '../store/memory-store.js'
import { OAuthStore } from './store.js'
import { AuthInfo, OAuthProvider, OAuthResponse } from './types.js'
import { assertSafeMetadataUrl } from './ssrf.js'
import { matchRedirectUri } from './uri.js'

/**
 * RFC 8707 resource indicators this authorization server will mint an `aud` for,
 * beyond `resourceUrl` itself: exact identifiers, or a predicate (async is fine -
 * tenant existence can hit a store). Unset keeps pre-5.1 behavior, where the
 * indicator is ignored and every token is minted for `resourceUrl`.
 *
 * **`aud` is not membership.** This server will mint `aud: …/tenantA` for any
 * authenticated upstream user who asks, including one with no rights in tenant
 * A. The indicator says where a token may be *presented*, never what its subject
 * may *do* there. Per-tenant authorization stays the resource server's job on
 * every call - a consumer treating "aud matches my tenant" as an access grant
 * has built a privilege escalation.
 *
 * Note the predicate runs on every `verifyToken`, so a store-backed check is a
 * hit per bearer validation: cache it, and be aware the store's availability
 * becomes the token path's availability.
 */
export type AllowedResources = string[] | ((resource: string) => boolean | Promise<boolean>)

export interface OAuthProxyConfig {
  authorizeUrl: string
  tokenUrl: string
  userinfoUrl?: string
  clientId: string
  clientSecret: string
  /** Authorization-server identity: `iss`, the endpoint base, and the default audience. */
  resourceUrl: string
  redirectUris: string[]
  requiredScopes?: string[]
  callbackPath?: string
  signingKey?: string
  tokenTtl?: number
  store?: OAuthStore
  allowedResources?: AllowedResources
}

/** Reading a `resource` parameter that may arrive repeated (and so as an array). */
type ResourceParam = { ok: true; value?: string } | { ok: false }

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

/**
 * Read and validate the `resource` indicator on the /authorize leg. Without
 * `allowedResources` the value is captured-and-ignored, exactly as before
 * multi-resource support.
 */
async function readAuthorizeResource(
  params: URLSearchParams,
  multiResource: boolean,
  isAllowedResource: (resource: string) => Promise<boolean>
): Promise<{ ok: true; value?: string } | { ok: false; response: OAuthResponse }> {
  if (!multiResource) {
    return { ok: true, value: params.get('resource') ?? undefined }
  }

  // RFC 8707 permits repeats; we deliberately support exactly one resource per
  // grant, so `aud` stays a single string and the token endpoint's equality rule
  // stays trivial. MCP clients send exactly one.
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
  if (!(await isAllowedResource(normalized))) {
    return { ok: false, response: errorResponse(400, 'invalid_target', 'Unknown or unsupported resource') }
  }
  return { ok: true, value: normalized }
}

/** Build the "may this AS mint for that resource?" check. The allow-list is the AS's, never the client's. */
function resourceChecker(config: OAuthProxyConfig): (resource: string) => Promise<boolean> {
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

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': '*'
}

function generateCode(): string {
  return randomBytes(32).toString('base64url')
}

async function generatePkce(): Promise<{ verifier: string; challenge: string }> {
  const verifier = randomBytes(32).toString('base64url')
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
  const challenge = Buffer.from(hash).toString('base64url')
  return { verifier, challenge }
}

async function verifyPkce(verifier: string, challenge: string): Promise<boolean> {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
  const computed = Buffer.from(hash).toString('base64url')
  return computed === challenge
}

function jsonResponse(
  status: number,
  body: Record<string, unknown>,
  headers: Record<string, string> = {}
): OAuthResponse {
  return {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS, ...headers },
    body
  }
}

function redirectResponse(url: string): OAuthResponse {
  return {
    status: 302,
    headers: { Location: url, ...CORS_HEADERS },
    body: undefined
  }
}

function errorResponse(status: number, error: string, description: string): OAuthResponse {
  return jsonResponse(status, { error, error_description: description })
}

async function signAccessToken(
  key: Uint8Array,
  opts: {
    scopes: string[]
    email?: string
    sub?: string
    clientId: string
    issuer: string
    audience?: string
    ttl: number
  }
): Promise<string> {
  const now = Math.floor(Date.now() / 1000)
  return (
    new SignJWT({ scope: opts.scopes.join(' '), email: opts.email })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(opts.sub ?? opts.email ?? opts.clientId)
      .setIssuer(opts.issuer)
      // The AS identity never fragments; only the audience follows the resource.
      .setAudience(opts.audience ?? opts.issuer)
      .setIssuedAt(now)
      .setExpirationTime(now + opts.ttl)
      .sign(key)
  )
}

async function handleRegister(
  req: { body?: Record<string, string> },
  store: OAuthStore,
  allowedRedirectUris: string[]
): Promise<OAuthResponse> {
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
    if (!matchRedirectUri(uri, allowedRedirectUris)) {
      return errorResponse(400, 'invalid_redirect_uri', `Redirect URI not allowed: ${uri}`)
    }
  }

  const clientId = randomUUID()
  const clientSecret = randomBytes(32).toString('base64url')
  const registration = {
    clientId,
    clientSecret,
    redirectUris: uris,
    clientName: body.client_name,
    createdAt: Date.now() / 1000
  }

  await store.saveClient(clientId, registration)

  return jsonResponse(201, {
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uris: uris,
    client_name: body.client_name,
    token_endpoint_auth_method: 'none'
  })
}

async function resolveClient(
  clientId: string,
  store: OAuthStore,
  allowedRedirectUris: string[]
): Promise<
  | { clientId: string; clientSecret: string; redirectUris: string[]; clientName?: string; createdAt: number }
  | OAuthResponse
> {
  const existing = await store.getClient(clientId)
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
    const metaRedirectUris = meta.redirect_uris as string[] | undefined
    if (!Array.isArray(metaRedirectUris) || metaRedirectUris.length === 0) {
      return errorResponse(400, 'invalid_client', 'Client metadata must include redirect_uris')
    }
    for (const uri of metaRedirectUris) {
      if (!matchRedirectUri(uri, allowedRedirectUris)) {
        return errorResponse(400, 'invalid_redirect_uri', `Redirect URI not allowed: ${uri}`)
      }
    }
    const client = {
      clientId,
      clientSecret: '',
      redirectUris: metaRedirectUris,
      clientName: meta.client_name as string | undefined,
      createdAt: Date.now() / 1000
    }
    await store.saveClient(clientId, client)
    return client
  } catch {
    return errorResponse(400, 'invalid_client', 'Failed to fetch client metadata document')
  }
}

async function exchangeUpstreamCode(
  code: string,
  config: OAuthProxyConfig,
  callbackPath: string,
  pkceVerifier: string
): Promise<{ accessToken: string; idToken?: string } | OAuthResponse> {
  const tokenBody = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: `${config.resourceUrl}${callbackPath}`,
    client_id: config.clientId,
    client_secret: config.clientSecret,
    code_verifier: pkceVerifier
  })

  const tokenResponse = await fetch(config.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: tokenBody.toString()
  })

  if (!tokenResponse.ok) {
    const errorBody = await tokenResponse.text()
    console.error('Upstream token exchange failed:', errorBody)
    return errorResponse(502, 'upstream_error', 'Failed to exchange code with upstream provider')
  }

  const tokens = (await tokenResponse.json()) as Record<string, unknown>
  return {
    accessToken: tokens.access_token as string,
    idToken: tokens.id_token as string | undefined
  }
}

async function fetchUserinfo(
  userinfoUrl: string | undefined,
  accessToken: string
): Promise<{ email?: string; sub?: string }> {
  if (!userinfoUrl || !accessToken) {
    return {}
  }
  try {
    const res = await fetch(userinfoUrl, {
      headers: { Authorization: `Bearer ${accessToken}` }
    })
    if (res.ok) {
      const userinfo = (await res.json()) as Record<string, unknown>
      return { email: userinfo.email as string | undefined, sub: userinfo.sub as string | undefined }
    }
  } catch {
    // Userinfo fetch is best-effort
  }
  return {}
}

async function handleRefreshToken(
  body: Record<string, string>,
  store: OAuthStore,
  getSigningKey: () => Promise<Uint8Array>,
  config: { resourceUrl: string; tokenTtl: number },
  multiResource: boolean
): Promise<OAuthResponse> {
  const refreshToken = body.refresh_token
  if (!refreshToken) {
    return errorResponse(400, 'invalid_request', 'Missing refresh_token')
  }

  // Legacy mode ignores a `resource` in the token body entirely, as before.
  const requested = multiResource ? readBodyResource(body) : ({ ok: true } as ResourceParam)
  if (!requested.ok) {
    return errorResponse(400, 'invalid_target', 'Invalid resource indicator')
  }

  const tokenData = await store.getRefreshToken(refreshToken)
  if (!tokenData) {
    return errorResponse(400, 'invalid_grant', 'Invalid or expired refresh token')
  }

  // A refresh token must not be a lateral move to a different audience. The
  // stored value was validated at mint, so equality is the whole rule here.
  // An absent stored `resource` means the chain was minted for the default
  // audience, so a client restating that resource is asking for what it already
  // has - the SDK sends `resource` on the refresh leg too, and rejecting that
  // would be a spurious 400.
  if (requested.value !== undefined) {
    const bound = tokenData.resource ?? normalizeResourceUri(config.resourceUrl) ?? config.resourceUrl
    if (requested.value !== bound) {
      return errorResponse(400, 'invalid_target', 'resource does not match the refresh token')
    }
  }

  // Bind the refresh token to the presenting client. Public clients
  // (token_endpoint_auth_method 'none') send client_id in the body; a token
  // presented by a different client_id than it was issued to is rejected.
  if (body.client_id && body.client_id !== tokenData.clientId) {
    return errorResponse(400, 'invalid_grant', 'refresh_token was not issued to this client')
  }

  const key = await getSigningKey()
  const accessToken = await signAccessToken(key, {
    scopes: tokenData.scopes,
    email: tokenData.email,
    sub: tokenData.sub,
    clientId: tokenData.clientId,
    issuer: config.resourceUrl,
    audience: tokenData.resource,
    ttl: config.tokenTtl
  })

  // Rotate (OAuth 2.1 for public clients): invalidate the presented token and
  // issue a fresh one. Preserve the original absolute expiry so repeated
  // rotation cannot extend a leaked token's lifetime indefinitely.
  await store.deleteRefreshToken(refreshToken)
  const newRefreshToken = randomBytes(32).toString('base64url')
  await store.saveRefreshToken(newRefreshToken, {
    clientId: tokenData.clientId,
    scopes: tokenData.scopes,
    email: tokenData.email,
    sub: tokenData.sub,
    resource: tokenData.resource,
    expiresAt: tokenData.expiresAt
  })

  return jsonResponse(200, {
    access_token: accessToken,
    token_type: 'Bearer',
    expires_in: config.tokenTtl,
    scope: tokenData.scopes.join(' '),
    refresh_token: newRefreshToken
  })
}

async function handleAuthorizationCode(
  body: Record<string, string>,
  store: OAuthStore,
  getSigningKey: () => Promise<Uint8Array>,
  config: { resourceUrl: string; tokenTtl: number },
  multiResource: boolean,
  isAllowedResource: (resource: string) => Promise<boolean>
): Promise<OAuthResponse> {
  const code = body.code
  const redirectUri = body.redirect_uri
  const clientId = body.client_id
  const codeVerifier = body.code_verifier

  if (!code || !codeVerifier || !clientId) {
    return errorResponse(400, 'invalid_request', 'Missing required parameters')
  }

  const requested = multiResource ? readBodyResource(body) : ({ ok: true } as ResourceParam)
  if (!requested.ok) {
    return errorResponse(400, 'invalid_target', 'Invalid resource indicator')
  }

  const authCode = await store.getAuthCode(code)
  if (!authCode) {
    return errorResponse(400, 'invalid_grant', 'Invalid or expired authorization code')
  }

  await store.deleteAuthCode(code)

  if (authCode.clientId !== clientId) {
    return errorResponse(400, 'invalid_grant', 'client_id mismatch')
  }
  if (redirectUri && authCode.redirectUri !== redirectUri) {
    return errorResponse(400, 'invalid_grant', 'redirect_uri mismatch')
  }

  const pkceValid = await verifyPkce(codeVerifier, authCode.codeChallenge)
  if (!pkceValid) {
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
  if (effectiveResource !== undefined && !(await isAllowedResource(effectiveResource))) {
    return errorResponse(400, 'invalid_target', 'Unknown or unsupported resource')
  }

  const key = await getSigningKey()
  const accessToken = await signAccessToken(key, {
    scopes: authCode.scopes,
    email: authCode.email,
    sub: authCode.sub,
    clientId: authCode.clientId,
    issuer: config.resourceUrl,
    audience: effectiveResource,
    ttl: config.tokenTtl
  })

  const refreshToken = randomBytes(32).toString('base64url')
  await store.saveRefreshToken(refreshToken, {
    clientId: authCode.clientId,
    scopes: authCode.scopes,
    email: authCode.email,
    sub: authCode.sub,
    resource: effectiveResource,
    expiresAt: Math.floor(Date.now() / 1000) + 30 * 24 * 3600
  })

  return jsonResponse(200, {
    access_token: accessToken,
    token_type: 'Bearer',
    expires_in: config.tokenTtl,
    scope: authCode.scopes.join(' '),
    refresh_token: refreshToken
  })
}

/** Shape a verified JWT payload into an `AuthInfo`. */
function authInfoFromPayload(token: string, payload: Record<string, unknown>): AuthInfo {
  return {
    token,
    clientId: (payload.sub as string | undefined) ?? undefined,
    scopes: typeof payload.scope === 'string' ? payload.scope.split(' ').filter(Boolean) : [],
    expiresAt: payload.exp as number | undefined,
    email: payload.email
  }
}

/**
 * Verify a proxy-minted access token.
 *
 * Without `allowedResources` this keeps the historical double pin (issuer +
 * audience) verbatim. With it, the audience pin is replaced by a manual check -
 * and that check has to be stricter than it looks. `jwtVerify`'s `audience`
 * option *requires* the claim to be present; dropping it would accept an
 * `aud`-less token, which `validateToken` in turn treats as a pass. So require a
 * single non-empty string (the proxy never mints arrays) and check membership.
 *
 * The membership check is not defence against a signing-key compromise - an
 * attacker holding the key mints allowed audiences trivially. Its value is
 * revocation (a deleted tenant stops validating) and misconfiguration
 * containment. Returning `aud`/`iss` is the load-bearing part: it turns
 * `validateToken`'s per-endpoint audience binding from vacuous into the actual
 * confused-deputy defence.
 */
async function verifyAccessToken(
  token: string,
  getSigningKey: () => Promise<Uint8Array>,
  issuer: string,
  multiResource: boolean,
  isAllowedResource: (resource: string) => Promise<boolean>
): Promise<AuthInfo | undefined> {
  try {
    const key = await getSigningKey()

    if (!multiResource) {
      const { payload } = await jwtVerify(token, key, { issuer, audience: issuer })
      return authInfoFromPayload(token, payload)
    }

    const { payload } = await jwtVerify(token, key, { issuer })
    const aud = payload.aud
    if (typeof aud !== 'string' || aud === '') {
      return undefined
    }
    if (!(await isAllowedResource(aud))) {
      return undefined
    }

    return {
      ...authInfoFromPayload(token, payload),
      aud,
      iss: typeof payload.iss === 'string' ? payload.iss : undefined
    }
  } catch {
    return undefined
  }
}

export function createOAuthProxy(config: OAuthProxyConfig): OAuthProvider {
  const store = config.store ?? createMemoryStore()
  const callbackPath = config.callbackPath ?? '/auth/callback'
  const tokenTtl = config.tokenTtl ?? 3600
  const scopes = config.requiredScopes ?? []
  const multiResource = config.allowedResources !== undefined
  const isAllowedResource = resourceChecker(config)

  let signingKey: Uint8Array | null = null

  async function getSigningKey(): Promise<Uint8Array> {
    if (signingKey) {
      return signingKey
    }
    if (config.signingKey) {
      signingKey = new TextEncoder().encode(config.signingKey)
    } else {
      signingKey = randomBytes(32)
    }
    return signingKey
  }

  return {
    metadata(): OAuthResponse {
      return jsonResponse(
        200,
        {
          issuer: config.resourceUrl,
          authorization_endpoint: `${config.resourceUrl}/authorize`,
          token_endpoint: `${config.resourceUrl}/token`,
          registration_endpoint: `${config.resourceUrl}/register`,
          response_types_supported: ['code'],
          grant_types_supported: ['authorization_code', 'refresh_token'],
          code_challenge_methods_supported: ['S256'],
          token_endpoint_auth_methods_supported: ['none', 'client_secret_post'],
          scopes_supported: scopes
        },
        { 'Cache-Control': 'max-age=3600' }
      )
    },

    register(req) {
      return handleRegister(req, store, config.redirectUris)
    },

    async authorize(req): Promise<OAuthResponse> {
      const params = req.url.searchParams
      const responseType = params.get('response_type')
      const clientId = params.get('client_id')
      const redirectUri = params.get('redirect_uri')
      const scope = params.get('scope') ?? ''
      const clientState = params.get('state') ?? ''
      const codeChallenge = params.get('code_challenge')
      const codeChallengeMethod = params.get('code_challenge_method')

      const requestedResource = await readAuthorizeResource(params, multiResource, isAllowedResource)
      if (!requestedResource.ok) {
        return requestedResource.response
      }
      const resource = requestedResource.value

      if (responseType !== 'code') {
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

      const result = await resolveClient(clientId, store, config.redirectUris)
      if ('status' in result) {
        return result
      }
      const client = result

      if (!client.redirectUris.includes(redirectUri)) {
        return errorResponse(400, 'invalid_redirect_uri', 'redirect_uri does not match registered URIs')
      }

      const proxyState = randomUUID()
      const pkce = await generatePkce()

      await store.savePendingAuth(proxyState, {
        clientId,
        redirectUri,
        codeChallenge,
        codeChallengeMethod,
        scope,
        clientState,
        resource,
        expiresAt: Date.now() / 1000 + 600
      })

      await store.savePkceVerifier(proxyState, pkce.verifier)

      const upstreamScopes = scopes.length > 0 ? scopes.join(' ') : scope
      const upstreamUrl = new URL(config.authorizeUrl)
      upstreamUrl.searchParams.set('response_type', 'code')
      upstreamUrl.searchParams.set('client_id', config.clientId)
      upstreamUrl.searchParams.set('redirect_uri', `${config.resourceUrl}${callbackPath}`)
      upstreamUrl.searchParams.set('scope', upstreamScopes)
      upstreamUrl.searchParams.set('state', proxyState)
      upstreamUrl.searchParams.set('code_challenge', pkce.challenge)
      upstreamUrl.searchParams.set('code_challenge_method', 'S256')
      if (params.has('access_type')) {
        upstreamUrl.searchParams.set('access_type', params.get('access_type')!)
      }

      return redirectResponse(upstreamUrl.toString())
    },

    async callback(req): Promise<OAuthResponse> {
      const params = req.url.searchParams
      const upstreamCode = params.get('code')
      const proxyState = params.get('state')
      const upstreamError = params.get('error')

      if (upstreamError) {
        return errorResponse(400, 'upstream_error', params.get('error_description') ?? upstreamError)
      }
      if (!upstreamCode || !proxyState) {
        return errorResponse(400, 'invalid_request', 'Missing code or state')
      }

      const pending = await store.getPendingAuth(proxyState)
      if (!pending) {
        return errorResponse(400, 'invalid_request', 'Unknown or expired state')
      }

      const pkceVerifier = await store.getPkceVerifier(proxyState)
      if (!pkceVerifier) {
        return errorResponse(400, 'invalid_request', 'Missing PKCE verifier')
      }

      await store.deletePendingAuth(proxyState)
      await store.deletePkceVerifier(proxyState)

      const upstream = await exchangeUpstreamCode(upstreamCode, config, callbackPath, pkceVerifier)
      if ('status' in upstream) {
        return upstream
      }

      const userinfo = await fetchUserinfo(config.userinfoUrl, upstream.accessToken)

      const mcpCode = generateCode()
      await store.saveAuthCode(mcpCode, {
        clientId: pending.clientId,
        redirectUri: pending.redirectUri,
        codeChallenge: pending.codeChallenge,
        codeChallengeMethod: pending.codeChallengeMethod,
        scopes: pending.scope.split(' ').filter(Boolean),
        upstreamAccessToken: upstream.accessToken,
        upstreamIdToken: upstream.idToken,
        email: userinfo.email,
        sub: userinfo.sub,
        resource: multiResource ? pending.resource : undefined,
        expiresAt: Date.now() / 1000 + 600
      })

      const clientRedirect = new URL(pending.redirectUri)
      clientRedirect.searchParams.set('code', mcpCode)
      if (pending.clientState) {
        clientRedirect.searchParams.set('state', pending.clientState)
      }

      return redirectResponse(clientRedirect.toString())
    },

    async token(req): Promise<OAuthResponse> {
      const body = req.body
      if (!body) {
        return errorResponse(400, 'invalid_request', 'Missing request body')
      }

      const tokenConfig = { resourceUrl: config.resourceUrl, tokenTtl }

      if (body.grant_type === 'refresh_token') {
        return handleRefreshToken(body, store, getSigningKey, tokenConfig, multiResource)
      }
      if (body.grant_type !== 'authorization_code') {
        return errorResponse(400, 'unsupported_grant_type', 'Supported grant types: authorization_code, refresh_token')
      }
      return handleAuthorizationCode(body, store, getSigningKey, tokenConfig, multiResource, isAllowedResource)
    },

    verifyToken(token): Promise<AuthInfo | undefined> {
      return verifyAccessToken(token, getSigningKey, config.resourceUrl, multiResource, isAllowedResource)
    }
  }
}
