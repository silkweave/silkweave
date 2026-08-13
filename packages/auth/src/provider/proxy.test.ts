import { createHash, randomBytes } from 'crypto'
import { decodeJwt } from 'jose'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryStore } from '../store/memory-store.js'
import { AllowedResources, createOAuthProxy } from './proxy.js'
import { OAuthProvider, OAuthRequest, OAuthResponse } from './types.js'

const AS = 'https://mcp.example.com'
const TENANT_A = 'https://mcp.example.com/yoexoexl'
const TENANT_B = 'https://mcp.example.com/kqwrmach'
const REDIRECT = 'https://client.example.com/callback'

/** Client-side PKCE pair, as a real MCP client would generate. */
function clientPkce(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString('base64url')
  const challenge = createHash('sha256').update(verifier).digest('base64url')
  return { verifier, challenge }
}

function req(url: string, body?: Record<string, string>): OAuthRequest {
  return { method: body ? 'POST' : 'GET', url: new URL(url), headers: {}, body }
}

function build(allowedResources?: AllowedResources): {
  provider: OAuthProvider
  store: ReturnType<typeof createMemoryStore>
} {
  const store = createMemoryStore()
  const provider = createOAuthProxy({
    authorizeUrl: 'https://upstream.example.com/authorize',
    tokenUrl: 'https://upstream.example.com/token',
    userinfoUrl: 'https://upstream.example.com/userinfo',
    clientId: 'upstream-client',
    clientSecret: 'upstream-secret',
    resourceUrl: AS,
    redirectUris: [REDIRECT],
    signingKey: 'test-signing-key-of-sufficient-length',
    store,
    allowedResources
  })
  return { provider, store }
}

/** Stub the upstream IdP's token + userinfo endpoints. */
function stubUpstream(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL) => {
      const url = String(input)
      if (url.includes('/token')) {
        return new Response(JSON.stringify({ access_token: 'upstream-at', id_token: 'upstream-it' }), { status: 200 })
      }
      if (url.includes('/userinfo')) {
        return new Response(JSON.stringify({ email: 'user@example.com', sub: 'user-1' }), { status: 200 })
      }
      return new Response('not found', { status: 404 })
    })
  )
}

/**
 * Drive authorize -> upstream callback -> token, returning the token response.
 * `authorizeResource` / `tokenResource` are the RFC 8707 indicators the client
 * sends on each leg (the MCP spec has clients send it on both).
 */
async function runFlow(
  provider: OAuthProvider,
  store: ReturnType<typeof createMemoryStore>,
  opts: { authorizeResource?: string; tokenResource?: string } = {}
): Promise<OAuthResponse> {
  await store.saveClient('test-client', {
    clientId: 'test-client',
    clientSecret: '',
    redirectUris: [REDIRECT],
    createdAt: Date.now() / 1000
  })

  const pkce = clientPkce()
  const authorizeUrl = new URL(`${AS}/authorize`)
  authorizeUrl.searchParams.set('response_type', 'code')
  authorizeUrl.searchParams.set('client_id', 'test-client')
  authorizeUrl.searchParams.set('redirect_uri', REDIRECT)
  authorizeUrl.searchParams.set('code_challenge', pkce.challenge)
  authorizeUrl.searchParams.set('code_challenge_method', 'S256')
  if (opts.authorizeResource) {
    authorizeUrl.searchParams.set('resource', opts.authorizeResource)
  }

  const authorized = await provider.authorize(req(authorizeUrl.toString()))
  if (authorized.status !== 302) {
    return authorized
  }

  const upstreamState = new URL(authorized.headers.Location).searchParams.get('state')!
  const callbackUrl = `${AS}/auth/callback?code=upstream-code&state=${upstreamState}`
  const callback = await provider.callback(req(callbackUrl))
  if (callback.status !== 302) {
    return callback
  }

  const code = new URL(callback.headers.Location).searchParams.get('code')!

  return provider.token(
    req(`${AS}/token`, {
      grant_type: 'authorization_code',
      code,
      code_verifier: pkce.verifier,
      client_id: 'test-client',
      redirect_uri: REDIRECT,
      ...(opts.tokenResource ? { resource: opts.tokenResource } : {})
    })
  )
}

const audOf = (response: OAuthResponse): unknown =>
  decodeJwt((response.body as { access_token: string }).access_token).aud

beforeEach(stubUpstream)
afterEach(() => {
  vi.unstubAllGlobals()
})

describe('createOAuthProxy - legacy mode (no allowedResources)', () => {
  it('mints a token for resourceUrl when no indicator is sent', async () => {
    const { provider, store } = build()
    const response = await runFlow(provider, store)
    expect(response.status).toBe(200)
    expect(audOf(response)).toBe(AS)
  })

  it('ignores a resource indicator entirely (byte-identical to pre-5.1)', async () => {
    const { provider, store } = build()
    const response = await runFlow(provider, store, { authorizeResource: TENANT_A, tokenResource: TENANT_A })
    expect(response.status).toBe(200)
    expect(audOf(response)).toBe(AS)
  })

  it('verifies its own token with the historical double pin', async () => {
    const { provider, store } = build()
    const response = await runFlow(provider, store)
    const info = await provider.verifyToken((response.body as { access_token: string }).access_token)
    expect(info?.email).toBe('user@example.com')
    // Legacy AuthInfo deliberately carries no aud/iss - the binding lives in the pin.
    expect(info?.aud).toBeUndefined()
  })
})

describe('createOAuthProxy - multi-resource minting', () => {
  const allowed: AllowedResources = [TENANT_A, TENANT_B]

  it('mints the indicator as the audience when allowed', async () => {
    const { provider, store } = build(allowed)
    const response = await runFlow(provider, store, { authorizeResource: TENANT_A, tokenResource: TENANT_A })
    expect(response.status).toBe(200)
    expect(audOf(response)).toBe(TENANT_A)
  })

  it('falls back to the default audience when no indicator is sent', async () => {
    const { provider, store } = build(allowed)
    const response = await runFlow(provider, store)
    expect(audOf(response)).toBe(AS)
  })

  it('rejects a disallowed indicator at /authorize', async () => {
    const { provider, store } = build(allowed)
    const response = await runFlow(provider, store, { authorizeResource: 'https://mcp.example.com/nope' })
    expect(response.status).toBe(400)
    expect((response.body as { error: string }).error).toBe('invalid_target')
  })

  it('rejects a disallowed indicator smuggled in at /token', async () => {
    // The authorize leg carried nothing, so the allow-list must be re-checked
    // at redemption - otherwise omitting it on authorize bypasses the list.
    const { provider, store } = build(allowed)
    const response = await runFlow(provider, store, { tokenResource: 'https://mcp.example.com/nope' })
    expect(response.status).toBe(400)
    expect((response.body as { error: string }).error).toBe('invalid_target')
  })

  it('rejects an authorize/token indicator mismatch', async () => {
    const { provider, store } = build(allowed)
    const response = await runFlow(provider, store, { authorizeResource: TENANT_A, tokenResource: TENANT_B })
    expect(response.status).toBe(400)
    expect((response.body as { error: string }).error).toBe('invalid_target')
  })

  it('accepts an origin indicator that differs only by a trailing slash', async () => {
    // SDKs ship `new URL(resource)` stringifications; without normalization
    // every root-resource grant would 400.
    const { provider, store } = build(allowed)
    const response = await runFlow(provider, store, { authorizeResource: `${AS}/`, tokenResource: `${AS}/` })
    expect(response.status).toBe(200)
    expect(audOf(response)).toBe(AS)
  })

  it('rejects repeated resource params at /authorize', async () => {
    const { provider, store } = build(allowed)
    await store.saveClient('test-client', {
      clientId: 'test-client',
      clientSecret: '',
      redirectUris: [REDIRECT],
      createdAt: Date.now() / 1000
    })
    const url = new URL(`${AS}/authorize`)
    url.searchParams.set('response_type', 'code')
    url.searchParams.set('client_id', 'test-client')
    url.searchParams.set('redirect_uri', REDIRECT)
    url.searchParams.set('code_challenge', clientPkce().challenge)
    url.searchParams.set('code_challenge_method', 'S256')
    url.searchParams.append('resource', TENANT_A)
    url.searchParams.append('resource', TENANT_B)

    const response = await provider.authorize(req(url.toString()))
    expect(response.status).toBe(400)
    expect((response.body as { error: string }).error).toBe('invalid_target')
  })

  it('supports an async predicate (tenant existence)', async () => {
    const live = new Set([TENANT_A])
    const { provider, store } = build(async (resource) => live.has(resource))
    const ok = await runFlow(provider, store, { authorizeResource: TENANT_A, tokenResource: TENANT_A })
    expect(audOf(ok)).toBe(TENANT_A)

    const { provider: p2, store: s2 } = build(async (resource) => live.has(resource))
    const denied = await runFlow(p2, s2, { authorizeResource: TENANT_B })
    expect(denied.status).toBe(400)
  })
})

describe('createOAuthProxy - refresh preserves the audience', () => {
  const allowed: AllowedResources = [TENANT_A, TENANT_B]

  const refresh = (provider: OAuthProvider, token: string, resource?: string) =>
    provider.token(
      req(`${AS}/token`, {
        grant_type: 'refresh_token',
        refresh_token: token,
        client_id: 'test-client',
        ...(resource ? { resource } : {})
      })
    )

  it('re-mints the same audience across rotation', async () => {
    const { provider, store } = build(allowed)
    const first = await runFlow(provider, store, { authorizeResource: TENANT_A, tokenResource: TENANT_A })
    const refreshed = await refresh(provider, (first.body as { refresh_token: string }).refresh_token)
    expect(refreshed.status).toBe(200)
    expect(audOf(refreshed)).toBe(TENANT_A)
  })

  it('rejects a refresh that asks for a different audience', async () => {
    // A refresh token must not be a lateral move to another resource.
    const { provider, store } = build(allowed)
    const first = await runFlow(provider, store, { authorizeResource: TENANT_A, tokenResource: TENANT_A })
    const refreshed = await refresh(provider, (first.body as { refresh_token: string }).refresh_token, TENANT_B)
    expect(refreshed.status).toBe(400)
    expect((refreshed.body as { error: string }).error).toBe('invalid_target')
  })

  it('accepts a refresh restating the same audience', async () => {
    const { provider, store } = build(allowed)
    const first = await runFlow(provider, store, { authorizeResource: TENANT_A, tokenResource: TENANT_A })
    const refreshed = await refresh(provider, (first.body as { refresh_token: string }).refresh_token, TENANT_A)
    expect(audOf(refreshed)).toBe(TENANT_A)
  })

  it('accepts a refresh restating the default audience for a default-bound chain', async () => {
    // The chain stores no `resource` (default audience), but MCP clients send
    // `resource` on the refresh leg - restating the AS must not be a 400.
    const { provider, store } = build(allowed)
    const first = await runFlow(provider, store)
    const refreshed = await refresh(provider, (first.body as { refresh_token: string }).refresh_token, `${AS}/`)
    expect(refreshed.status).toBe(200)
    expect(audOf(refreshed)).toBe(AS)
  })

  it('still rejects a tenant resource on a default-bound chain', async () => {
    const { provider, store } = build(allowed)
    const first = await runFlow(provider, store)
    const refreshed = await refresh(provider, (first.body as { refresh_token: string }).refresh_token, TENANT_A)
    expect(refreshed.status).toBe(400)
  })

  it('refreshes a pre-upgrade record into a default-audience token', async () => {
    // Records persisted before multi-resource support carry no `resource`.
    const { provider, store } = build(allowed)
    await store.saveRefreshToken('legacy-token', {
      clientId: 'test-client',
      scopes: ['openid'],
      email: 'user@example.com',
      expiresAt: Math.floor(Date.now() / 1000) + 3600
    })
    const refreshed = await refresh(provider, 'legacy-token')
    expect(audOf(refreshed)).toBe(AS)
  })
})

describe('createOAuthProxy - verifyToken audience binding', () => {
  const allowed: AllowedResources = [TENANT_A, TENANT_B]

  it('returns aud and iss so validateToken can bind per endpoint', async () => {
    const { provider, store } = build(allowed)
    const response = await runFlow(provider, store, { authorizeResource: TENANT_A, tokenResource: TENANT_A })
    const info = await provider.verifyToken((response.body as { access_token: string }).access_token)
    expect(info?.aud).toBe(TENANT_A)
    expect(info?.iss).toBe(AS)
  })

  it('rejects a token with no aud claim', async () => {
    // jwtVerify's `audience` option requires the claim; dropping the pin without
    // an explicit shape check would accept an aud-less token, and validateToken
    // treats an absent aud as a pass - the confused-deputy defence would
    // evaporate. The predicate here accepts everything, so the *only* thing that
    // can reject this token is the shape check itself.
    const { provider } = build(() => true)
    const { SignJWT } = await import('jose')
    const key = new TextEncoder().encode('test-signing-key-of-sufficient-length')
    const token = await new SignJWT({ scope: 'openid' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject('user-1')
      .setIssuer(AS)
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(key)
    expect(await provider.verifyToken(token)).toBeUndefined()
  })

  it('rejects a token whose aud is an array', async () => {
    // Same isolation: a permissive predicate means only the single-string
    // requirement can reject this. The proxy never mints arrays, so requiring
    // one is free - but the tightening versus the old pin is pinned here.
    const { provider } = build(() => true)
    const { SignJWT } = await import('jose')
    const key = new TextEncoder().encode('test-signing-key-of-sufficient-length')
    const token = await new SignJWT({ scope: 'openid' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject('user-1')
      .setIssuer(AS)
      .setAudience([TENANT_A, TENANT_B])
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(key)
    expect(await provider.verifyToken(token)).toBeUndefined()
  })

  it('rejects a token whose aud is outside the allow-list (revoked tenant)', async () => {
    const live = new Set([TENANT_A])
    const { provider, store } = build(async (resource) => live.has(resource))
    const response = await runFlow(provider, store, { authorizeResource: TENANT_A, tokenResource: TENANT_A })
    const token = (response.body as { access_token: string }).access_token
    expect((await provider.verifyToken(token))?.aud).toBe(TENANT_A)

    live.delete(TENANT_A)
    expect(await provider.verifyToken(token)).toBeUndefined()
  })

  it('rejects a token signed by a different key', async () => {
    const { provider } = build(allowed)
    const { SignJWT } = await import('jose')
    const token = await new SignJWT({ scope: 'openid' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject('user-1')
      .setIssuer(AS)
      .setAudience(TENANT_A)
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(new TextEncoder().encode('a-completely-different-signing-key!!'))
    expect(await provider.verifyToken(token)).toBeUndefined()
  })
})
