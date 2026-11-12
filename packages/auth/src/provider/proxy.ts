import { randomBytes, randomUUID } from 'crypto'
import {
  AllowedResources,
  AuthorizationServerConfig,
  createAuthorizationCore,
  errorResponse,
  redirectResponse,
  takePendingAuth
} from './core.js'
import { OAuthStore } from './store.js'
import { AuthInfo, OAuthProvider, OAuthResponse } from './types.js'

export type { AllowedResources, AuthorizationServerConfig, GrantRef, IsGrantActive } from './core.js'

export interface OAuthProxyConfig extends AuthorizationServerConfig {
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
  signingKey?: string | Uint8Array
  tokenTtl?: number
  store?: OAuthStore
  allowedResources?: AllowedResources
}

async function generatePkce(): Promise<{ verifier: string; challenge: string }> {
  const verifier = randomBytes(32).toString('base64url')
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
  return { verifier, challenge: Buffer.from(hash).toString('base64url') }
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
    console.error('Upstream token exchange failed:', await tokenResponse.text())
    return errorResponse(502, 'upstream_error', 'Failed to exchange code with upstream provider')
  }
  const tokens = (await tokenResponse.json()) as Record<string, unknown>
  return { accessToken: tokens.access_token as string, idToken: tokens.id_token as string | undefined }
}

async function fetchUserinfo(
  userinfoUrl: string | undefined,
  accessToken: string
): Promise<{ email?: string; sub?: string }> {
  if (!userinfoUrl || !accessToken) {
    return {}
  }
  try {
    const res = await fetch(userinfoUrl, { headers: { Authorization: `Bearer ${accessToken}` } })
    if (res.ok) {
      const userinfo = (await res.json()) as Record<string, unknown>
      return { email: userinfo.email as string | undefined, sub: userinfo.sub as string | undefined }
    }
  } catch {
    // Userinfo fetch is best-effort
  }
  return {}
}

/**
 * OAuth 2.1 authorization server that authenticates the person at an upstream
 * IdP (Google, any OIDC provider): the client talks to this server, which
 * round-trips the upstream authorize/token endpoints and mints its own tokens.
 * When your app is itself the identity provider (a signed-in session), use
 * `createOAuthServer` instead.
 */
export function createOAuthProxy(config: OAuthProxyConfig): OAuthProvider {
  const scopes = config.requiredScopes ?? []
  const callbackPath = config.callbackPath ?? '/auth/callback'
  const core = createAuthorizationCore(config, { scopesSupported: scopes })
  const { store } = core

  return {
    metadata: core.metadata,
    register: core.register,

    async authorize(req): Promise<OAuthResponse> {
      const validated = await core.validateAuthorize(req)
      if ('status' in validated) {
        return validated
      }
      const { pending, params } = validated
      const proxyState = randomUUID()
      const pkce = await generatePkce()
      await store.savePendingAuth(proxyState, pending)
      await store.savePkceVerifier(proxyState, pkce.verifier)

      const upstreamUrl = new URL(config.authorizeUrl)
      upstreamUrl.searchParams.set('response_type', 'code')
      upstreamUrl.searchParams.set('client_id', config.clientId)
      upstreamUrl.searchParams.set('redirect_uri', `${config.resourceUrl}${callbackPath}`)
      upstreamUrl.searchParams.set('scope', scopes.length > 0 ? scopes.join(' ') : pending.scope)
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
      // Atomic single use: a replayed upstream callback cannot mint a second code.
      const pending = await takePendingAuth(store, proxyState)
      if (!pending) {
        return errorResponse(400, 'invalid_request', 'Unknown or expired state')
      }
      const pkceVerifier = await store.getPkceVerifier(proxyState)
      await store.deletePkceVerifier(proxyState)
      if (!pkceVerifier) {
        return errorResponse(400, 'invalid_request', 'Missing PKCE verifier')
      }

      const upstream = await exchangeUpstreamCode(upstreamCode, config, callbackPath, pkceVerifier)
      if ('status' in upstream) {
        return upstream
      }
      const userinfo = await fetchUserinfo(config.userinfoUrl, upstream.accessToken)
      const location = await core.issueCode(pending, userinfo, {
        upstreamAccessToken: upstream.accessToken,
        upstreamIdToken: upstream.idToken
      })
      return redirectResponse(location)
    },

    token: core.token,

    verifyToken(token): Promise<AuthInfo | undefined> {
      return core.verifyToken(token)
    }
  }
}
