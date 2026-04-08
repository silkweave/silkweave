import { randomBytes, randomUUID } from 'crypto'
import { SignJWT, jwtVerify } from 'jose'
import { createMemoryStore } from '../store/memory-store.js'
import { OAuthStore } from './store.js'
import { AuthInfo, OAuthProvider, OAuthResponse } from './types.js'
import { matchRedirectUri } from './uri.js'

export interface OAuthProxyConfig {
  authorizeUrl: string
  tokenUrl: string
  userinfoUrl?: string
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

function jsonResponse(status: number, body: Record<string, unknown>, headers: Record<string, string> = {}): OAuthResponse {
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
  opts: { scopes: string[]; email?: string; sub?: string; clientId: string; issuer: string; ttl: number }
): Promise<string> {
  const now = Math.floor(Date.now() / 1000)
  return new SignJWT({ scope: opts.scopes.join(' '), email: opts.email })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(opts.sub ?? opts.email ?? opts.clientId)
    .setIssuer(opts.issuer)
    .setAudience(opts.issuer)
    .setIssuedAt(now)
    .setExpirationTime(now + opts.ttl)
    .sign(key)
}

async function handleRegister(
  req: { body?: Record<string, string> },
  store: OAuthStore,
  allowedRedirectUris: string[]
): Promise<OAuthResponse> {
  const body = req.body
  if (!body) { return errorResponse(400, 'invalid_request', 'Missing request body') }

  const redirectUris = body.redirect_uris
  if (!redirectUris) { return errorResponse(400, 'invalid_request', 'redirect_uris is required') }

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
): Promise<{ clientId: string; clientSecret: string; redirectUris: string[]; clientName?: string; createdAt: number } | OAuthResponse> {
  const existing = await store.getClient(clientId)
  if (existing) { return existing }

  if (!clientId.startsWith('https://')) {
    return errorResponse(400, 'invalid_client', 'Unknown client_id')
  }

  try {
    const metaRes = await fetch(clientId)
    if (!metaRes.ok) {
      return errorResponse(400, 'invalid_client', 'Failed to fetch client metadata document')
    }
    const meta = await metaRes.json() as Record<string, unknown>
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

  const tokens = await tokenResponse.json() as Record<string, unknown>
  return {
    accessToken: tokens.access_token as string,
    idToken: tokens.id_token as string | undefined
  }
}

async function fetchUserinfo(
  userinfoUrl: string | undefined,
  accessToken: string
): Promise<{ email?: string; sub?: string }> {
  if (!userinfoUrl || !accessToken) { return {} }
  try {
    const res = await fetch(userinfoUrl, {
      headers: { Authorization: `Bearer ${accessToken}` }
    })
    if (res.ok) {
      const userinfo = await res.json() as Record<string, unknown>
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
  config: { resourceUrl: string; tokenTtl: number }
): Promise<OAuthResponse> {
  const refreshToken = body.refresh_token
  if (!refreshToken) {
    return errorResponse(400, 'invalid_request', 'Missing refresh_token')
  }

  const tokenData = await store.getRefreshToken(refreshToken)
  if (!tokenData) {
    return errorResponse(400, 'invalid_grant', 'Invalid or expired refresh token')
  }

  const key = await getSigningKey()
  const accessToken = await signAccessToken(key, {
    scopes: tokenData.scopes,
    email: tokenData.email,
    sub: tokenData.sub,
    clientId: tokenData.clientId,
    issuer: config.resourceUrl,
    ttl: config.tokenTtl
  })

  return jsonResponse(200, {
    access_token: accessToken,
    token_type: 'Bearer',
    expires_in: config.tokenTtl,
    scope: tokenData.scopes.join(' '),
    refresh_token: refreshToken
  })
}

async function handleAuthorizationCode(
  body: Record<string, string>,
  store: OAuthStore,
  getSigningKey: () => Promise<Uint8Array>,
  config: { resourceUrl: string; tokenTtl: number }
): Promise<OAuthResponse> {
  const code = body.code
  const redirectUri = body.redirect_uri
  const clientId = body.client_id
  const codeVerifier = body.code_verifier

  if (!code || !codeVerifier || !clientId) {
    return errorResponse(400, 'invalid_request', 'Missing required parameters')
  }

  const authCode = await store.getAuthCode(code)
  if (!authCode) { return errorResponse(400, 'invalid_grant', 'Invalid or expired authorization code') }

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

  const key = await getSigningKey()
  const accessToken = await signAccessToken(key, {
    scopes: authCode.scopes,
    email: authCode.email,
    sub: authCode.sub,
    clientId: authCode.clientId,
    issuer: config.resourceUrl,
    ttl: config.tokenTtl
  })

  const refreshToken = randomBytes(32).toString('base64url')
  await store.saveRefreshToken(refreshToken, {
    clientId: authCode.clientId,
    scopes: authCode.scopes,
    email: authCode.email,
    sub: authCode.sub,
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

export function createOAuthProxy(config: OAuthProxyConfig): OAuthProvider {
  const store = config.store ?? createMemoryStore()
  const callbackPath = config.callbackPath ?? '/auth/callback'
  const tokenTtl = config.tokenTtl ?? 3600
  const scopes = config.requiredScopes ?? []

  let signingKey: Uint8Array | null = null

  async function getSigningKey(): Promise<Uint8Array> {
    if (signingKey) { return signingKey }
    if (config.signingKey) {
      signingKey = new TextEncoder().encode(config.signingKey)
    } else {
      signingKey = randomBytes(32)
    }
    return signingKey
  }

  return {
    metadata(): OAuthResponse {
      return jsonResponse(200, {
        issuer: config.resourceUrl,
        authorization_endpoint: `${config.resourceUrl}/authorize`,
        token_endpoint: `${config.resourceUrl}/token`,
        registration_endpoint: `${config.resourceUrl}/register`,
        response_types_supported: ['code'],
        grant_types_supported: ['authorization_code', 'refresh_token'],
        code_challenge_methods_supported: ['S256'],
        token_endpoint_auth_methods_supported: ['none', 'client_secret_post'],
        scopes_supported: scopes
      }, { 'Cache-Control': 'max-age=3600' })
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
      const resource = params.get('resource')

      if (responseType !== 'code') {
        return errorResponse(400, 'unsupported_response_type', 'Only response_type=code is supported')
      }
      if (!clientId) { return errorResponse(400, 'invalid_request', 'client_id is required') }
      if (!redirectUri) { return errorResponse(400, 'invalid_request', 'redirect_uri is required') }
      if (!codeChallenge || codeChallengeMethod !== 'S256') {
        return errorResponse(400, 'invalid_request', 'PKCE with S256 is required')
      }

      const result = await resolveClient(clientId, store, config.redirectUris)
      if ('status' in result) { return result }
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
        resource: resource ?? undefined,
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
      if (!pending) { return errorResponse(400, 'invalid_request', 'Unknown or expired state') }

      const pkceVerifier = await store.getPkceVerifier(proxyState)
      if (!pkceVerifier) { return errorResponse(400, 'invalid_request', 'Missing PKCE verifier') }

      await store.deletePendingAuth(proxyState)
      await store.deletePkceVerifier(proxyState)

      const upstream = await exchangeUpstreamCode(upstreamCode, config, callbackPath, pkceVerifier)
      if ('status' in upstream) { return upstream }

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
      if (!body) { return errorResponse(400, 'invalid_request', 'Missing request body') }

      const tokenConfig = { resourceUrl: config.resourceUrl, tokenTtl }

      if (body.grant_type === 'refresh_token') {
        return handleRefreshToken(body, store, getSigningKey, tokenConfig)
      }
      if (body.grant_type !== 'authorization_code') {
        return errorResponse(400, 'unsupported_grant_type', 'Supported grant types: authorization_code, refresh_token')
      }
      return handleAuthorizationCode(body, store, getSigningKey, tokenConfig)
    },

    async verifyToken(token): Promise<AuthInfo | undefined> {
      try {
        const key = await getSigningKey()
        const { payload } = await jwtVerify(token, key, {
          issuer: config.resourceUrl,
          audience: config.resourceUrl
        })
        return {
          token,
          clientId: payload.sub ?? undefined,
          scopes: typeof payload.scope === 'string' ? payload.scope.split(' ').filter(Boolean) : [],
          expiresAt: payload.exp,
          email: payload.email as string | undefined
        }
      } catch {
        return undefined
      }
    }
  }
}
