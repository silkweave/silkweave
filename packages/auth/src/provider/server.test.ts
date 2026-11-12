import { decodeJwt } from 'jose'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createMemoryStore } from '../store/memory-store.js'
import { createOAuthServer, OAuthServerConfig, PendingAuthorization } from './server.js'
import { clientPkce, oauthRequest, REDIRECT, responseBody } from './testUtil.js'

const CONSENT = 'https://box.example.com/connect'
const at = (path = ''): string => `https://box.example.com/mcp${path}`

function build(overrides: Partial<OAuthServerConfig> = {}) {
  const store = createMemoryStore()
  const seen: PendingAuthorization[] = []
  const server = createOAuthServer({
    resourceUrl: at(),
    redirectUris: [REDIRECT, 'http://127.0.0.1:*', 'http://localhost:*', 'https://cimd.example.com/*'],
    signingKey: 'test-signing-key-of-sufficient-length',
    store,
    onAuthorize: (pending) => {
      seen.push(pending)
      return `${CONSENT}?request=${pending.id}`
    },
    ...overrides
  })
  return { server, store, seen }
}

async function registerClient(server: ReturnType<typeof build>['server'], redirect = REDIRECT): Promise<string> {
  const res = await server.register(
    oauthRequest(at('/register'), { redirect_uris: JSON.stringify([redirect]), client_name: 'Test <Client>' })
  )
  return (res.body as { client_id: string }).client_id
}

function authorizeUrl(clientId: string, challenge: string, redirect = REDIRECT, state = 'client-state'): string {
  const url = new URL(at('/authorize'))
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('client_id', clientId)
  url.searchParams.set('redirect_uri', redirect)
  url.searchParams.set('code_challenge', challenge)
  url.searchParams.set('code_challenge_method', 'S256')
  url.searchParams.set('state', state)
  url.searchParams.set('scope', 'mcp')
  return url.toString()
}

/** Register, authorize, approve as `sub`, redeem - returns the token response + client id. */
async function connect(ctx: ReturnType<typeof build>, sub = 'user-1') {
  const clientId = await registerClient(ctx.server)
  const pkce = clientPkce()
  const authorized = await ctx.server.authorize(oauthRequest(authorizeUrl(clientId, pkce.challenge)))
  const id = new URL(authorized.headers.Location).searchParams.get('request')!
  const approved = await ctx.server.approve(id, { sub, email: `${sub}@example.com` })
  const code = new URL(approved!.redirectTo).searchParams.get('code')!
  const token = await ctx.server.token(
    oauthRequest(at('/token'), {
      grant_type: 'authorization_code',
      code,
      code_verifier: pkce.verifier,
      client_id: clientId,
      redirect_uri: REDIRECT
    })
  )
  return { token, clientId }
}

function refresh(server: ReturnType<typeof build>['server'], refreshToken: string, clientId: string) {
  return server.token(
    oauthRequest(at('/token'), { grant_type: 'refresh_token', refresh_token: refreshToken, client_id: clientId })
  )
}

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('createOAuthServer - metadata and registration', () => {
  it('advertises public clients only, the iss response parameter and CIMD', () => {
    const meta = build().server.metadata().body as Record<string, unknown>
    expect(meta.issuer).toBe(at())
    expect(meta.authorization_endpoint).toBe(at('/authorize'))
    expect(meta.token_endpoint_auth_methods_supported).toEqual(['none'])
    expect(meta.authorization_response_iss_parameter_supported).toBe(true)
    expect(meta.client_id_metadata_document_supported).toBe(true)
  })

  it('registers a public client without minting a secret', async () => {
    const res = await build().server.register(
      oauthRequest(at('/register'), { redirect_uris: JSON.stringify([REDIRECT]) })
    )
    expect(res.status).toBe(201)
    expect(responseBody(res).token_endpoint_auth_method).toBe('none')
    expect(responseBody(res).client_secret).toBeUndefined()
  })

  it('has no callback endpoint', async () => {
    expect((await build().server.callback(oauthRequest(at('/auth/callback')))).status).toBe(404)
  })
})

describe('createOAuthServer - authorize and consent', () => {
  it('validates the request, stores it pending and hands the browser to onAuthorize', async () => {
    const ctx = build()
    const clientId = await registerClient(ctx.server)
    const res = await ctx.server.authorize(oauthRequest(authorizeUrl(clientId, clientPkce().challenge)))
    expect(res.status).toBe(302)
    expect(res.headers.Location).toMatch(new RegExp(`^${CONSENT}\\?request=`))
    const [pending] = ctx.seen
    expect(pending).toMatchObject({
      clientId,
      clientName: 'Test <Client>',
      clientKind: 'dcr',
      redirectUri: REDIRECT,
      redirectHost: 'client.example.com',
      scopes: ['mcp']
    })
    expect(pending.id).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(await ctx.server.pending(pending.id)).toEqual(pending)
  })

  it('lets onAuthorize return a full response (e.g. a binding cookie)', async () => {
    const ctx = build({
      onAuthorize: (pending) => ({
        status: 302,
        headers: { Location: `${CONSENT}?request=${pending.id}`, 'Set-Cookie': `bind=${pending.id}; HttpOnly` },
        body: undefined
      })
    })
    const clientId = await registerClient(ctx.server)
    const res = await ctx.server.authorize(oauthRequest(authorizeUrl(clientId, clientPkce().challenge)))
    expect(res.headers['Set-Cookie']).toMatch(/^bind=/)
  })

  it('rejects an invalid request before onAuthorize runs', async () => {
    const ctx = build()
    const res = await ctx.server.authorize(oauthRequest(authorizeUrl('unknown-client', clientPkce().challenge)))
    expect(res.status).toBe(400)
    expect(ctx.seen).toHaveLength(0)
  })

  it('approve returns the client redirect with code, state and iss - once', async () => {
    const ctx = build()
    const clientId = await registerClient(ctx.server)
    await ctx.server.authorize(oauthRequest(authorizeUrl(clientId, clientPkce().challenge)))
    const { id } = ctx.seen[0]
    const approved = await ctx.server.approve(id, { sub: 'user-1' })
    const redirect = new URL(approved!.redirectTo)
    expect(`${redirect.origin}${redirect.pathname}`).toBe(REDIRECT)
    expect(redirect.searchParams.get('code')).toBeTruthy()
    expect(redirect.searchParams.get('state')).toBe('client-state')
    expect(redirect.searchParams.get('iss')).toBe(at())
    expect(await ctx.server.approve(id, { sub: 'user-1' })).toBeUndefined()
    expect(await ctx.server.deny(id)).toBeUndefined()
    expect(await ctx.server.pending(id)).toBeUndefined()
  })

  it('deny returns access_denied with state and iss', async () => {
    const ctx = build()
    const clientId = await registerClient(ctx.server)
    await ctx.server.authorize(oauthRequest(authorizeUrl(clientId, clientPkce().challenge)))
    const denied = await ctx.server.deny(ctx.seen[0].id)
    const redirect = new URL(denied!.redirectTo)
    expect(redirect.searchParams.get('error')).toBe('access_denied')
    expect(redirect.searchParams.get('state')).toBe('client-state')
    expect(redirect.searchParams.get('iss')).toBe(at())
    expect(redirect.searchParams.get('code')).toBeNull()
  })

  it('expires a pending request after 10 minutes', async () => {
    vi.useFakeTimers()
    const ctx = build()
    const clientId = await registerClient(ctx.server)
    await ctx.server.authorize(oauthRequest(authorizeUrl(clientId, clientPkce().challenge)))
    vi.advanceTimersByTime(601_000)
    expect(await ctx.server.pending(ctx.seen[0].id)).toBeUndefined()
    expect(await ctx.server.approve(ctx.seen[0].id, { sub: 'user-1' })).toBeUndefined()
  })

  it('refuses an approval without a subject', async () => {
    const ctx = build()
    const clientId = await registerClient(ctx.server)
    await ctx.server.authorize(oauthRequest(authorizeUrl(clientId, clientPkce().challenge)))
    await expect(ctx.server.approve(ctx.seen[0].id, { sub: '' })).rejects.toThrow('sub')
  })
})

describe('createOAuthServer - tokens', () => {
  it('mints a token carrying sub, client_id and grant_id, and verifies it', async () => {
    const ctx = build()
    const { token, clientId } = await connect(ctx)
    expect(token.status).toBe(200)
    const claims = decodeJwt(responseBody(token).access_token)
    expect(claims).toMatchObject({ sub: 'user-1', client_id: clientId, iss: at(), aud: at(), scope: 'mcp' })
    expect(typeof claims.grant_id).toBe('string')
    const info = await ctx.server.verifyToken(responseBody(token).access_token)
    expect(info).toMatchObject({ sub: 'user-1', clientId: 'user-1', oauthClientId: clientId, grantId: claims.grant_id })
  })

  it('keeps the grant id across refresh rotation', async () => {
    const ctx = build()
    const { token, clientId } = await connect(ctx)
    const grantId = decodeJwt(responseBody(token).access_token).grant_id
    const refreshed = await refresh(ctx.server, responseBody(token).refresh_token, clientId)
    expect(refreshed.status).toBe(200)
    expect(decodeJwt(responseBody(refreshed).access_token).grant_id).toBe(grantId)
    expect(responseBody(refreshed).refresh_token).not.toBe(responseBody(token).refresh_token)
  })

  it('honors a concurrent reuse of the previous refresh token within the grace window', async () => {
    const ctx = build()
    const { token, clientId } = await connect(ctx)
    const first = await refresh(ctx.server, responseBody(token).refresh_token, clientId)
    const second = await refresh(ctx.server, responseBody(token).refresh_token, clientId)
    expect(first.status).toBe(200)
    expect(second.status).toBe(200)
  })

  it('revokes the whole grant when a rotated refresh token is replayed after the grace window', async () => {
    vi.useFakeTimers()
    const ctx = build()
    const { token, clientId } = await connect(ctx)
    const rotated = await refresh(ctx.server, responseBody(token).refresh_token, clientId)
    vi.advanceTimersByTime(31_000)
    const replay = await refresh(ctx.server, responseBody(token).refresh_token, clientId)
    expect(replay.status).toBe(400)
    expect(responseBody(replay).error).toBe('invalid_grant')
    // The legitimate successor dies with the chain.
    const successor = await refresh(ctx.server, responseBody(rotated).refresh_token, clientId)
    expect(successor.status).toBe(400)
  })

  it('does not let rotation extend the absolute expiry', async () => {
    vi.useFakeTimers()
    const ctx = build({ refreshTokenTtl: 100 })
    const { token, clientId } = await connect(ctx)
    vi.advanceTimersByTime(50_000)
    const rotated = await refresh(ctx.server, responseBody(token).refresh_token, clientId)
    vi.advanceTimersByTime(51_000)
    expect((await refresh(ctx.server, responseBody(rotated).refresh_token, clientId)).status).toBe(400)
  })
})

describe('createOAuthServer - isGrantActive', () => {
  it('is consulted on verify with the grant, subject and client', async () => {
    const isGrantActive = vi.fn(() => true)
    const ctx = build({ isGrantActive })
    const { token, clientId } = await connect(ctx)
    const grantId = decodeJwt(responseBody(token).access_token).grant_id
    expect(await ctx.server.verifyToken(responseBody(token).access_token)).toBeDefined()
    expect(isGrantActive).toHaveBeenCalledWith({ grantId, sub: 'user-1', clientId })
  })

  it('rejects the access token and the refresh grant of a revoked grant', async () => {
    let active = true
    const ctx = build({ isGrantActive: () => active })
    const { token, clientId } = await connect(ctx)
    active = false
    expect(await ctx.server.verifyToken(responseBody(token).access_token)).toBeUndefined()
    const refreshed = await refresh(ctx.server, responseBody(token).refresh_token, clientId)
    expect(refreshed.status).toBe(400)
    expect(responseBody(refreshed).error).toBe('invalid_grant')
  })
})

describe('createOAuthServer - redirect URIs', () => {
  async function authorizeWith(registered: string, presented: string) {
    const ctx = build()
    const clientId = await registerClient(ctx.server, registered)
    return ctx.server.authorize(oauthRequest(authorizeUrl(clientId, clientPkce().challenge, presented)))
  }

  it('matches a loopback redirect on any port (RFC 8252)', async () => {
    expect((await authorizeWith('http://127.0.0.1:4100/callback', 'http://127.0.0.1:5555/callback')).status).toBe(302)
    expect((await authorizeWith('http://localhost:4100/callback', 'http://localhost:6000/callback')).status).toBe(302)
  })

  it('does not treat localhost and 127.0.0.1 as interchangeable, or ignore the path', async () => {
    expect((await authorizeWith('http://localhost:4100/callback', 'http://127.0.0.1:4100/callback')).status).toBe(400)
    expect((await authorizeWith('http://127.0.0.1:4100/callback', 'http://127.0.0.1:4100/other')).status).toBe(400)
  })

  it('keeps exact matching for non-loopback redirects', async () => {
    const ctx = build({ redirectUris: ['https://client.example.com:*'] })
    const clientId = await registerClient(ctx.server, 'https://client.example.com:8443/callback')
    const res = await ctx.server.authorize(
      oauthRequest(authorizeUrl(clientId, clientPkce().challenge, 'https://client.example.com:9443/callback'))
    )
    expect(res.status).toBe(400)
  })
})

describe('createOAuthServer - resource indicators (single resource)', () => {
  it('accepts the resource with or without a trailing slash and mints for resourceUrl', async () => {
    for (const resource of [at(), `${at()}/`]) {
      const ctx = build()
      const clientId = await registerClient(ctx.server)
      const pkce = clientPkce()
      const url = new URL(authorizeUrl(clientId, pkce.challenge))
      url.searchParams.set('resource', resource)
      await ctx.server.authorize(oauthRequest(url.toString()))
      const approved = await ctx.server.approve(ctx.seen[0].id, { sub: 'user-1' })
      const token = await ctx.server.token(
        oauthRequest(at('/token'), {
          grant_type: 'authorization_code',
          code: new URL(approved!.redirectTo).searchParams.get('code')!,
          code_verifier: pkce.verifier,
          client_id: clientId,
          redirect_uri: REDIRECT,
          resource
        })
      )
      expect(token.status).toBe(200)
      expect(decodeJwt(responseBody(token).access_token).aud).toBe(at())
    }
  })
})

describe('createOAuthServer - client ID metadata documents', () => {
  const CIMD = 'https://cimd.example.com/client.json'

  function stubMetadata(doc: Record<string, unknown>) {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify(doc), { status: 200 }))
    )
  }

  it('accepts a document that names itself and reports the client as cimd', async () => {
    stubMetadata({ client_id: CIMD, client_name: 'Claude', redirect_uris: ['https://cimd.example.com/cb'] })
    const ctx = build()
    const res = await ctx.server.authorize(
      oauthRequest(authorizeUrl(CIMD, clientPkce().challenge, 'https://cimd.example.com/cb'))
    )
    expect(res.status).toBe(302)
    expect(ctx.seen[0]).toMatchObject({ clientKind: 'cimd', clientName: 'Claude' })
  })

  it('accepts port-less loopback redirects (Codex) and any port at authorize', async () => {
    stubMetadata({ client_id: CIMD, redirect_uris: ['http://127.0.0.1/callback', 'http://localhost/callback'] })
    const ctx = build()
    const res = await ctx.server.authorize(
      oauthRequest(authorizeUrl(CIMD, clientPkce().challenge, 'http://127.0.0.1:64361/callback'))
    )
    expect(res.status).toBe(302)
  })

  it('rejects a document whose client_id is not its own URL', async () => {
    stubMetadata({ client_id: 'https://evil.example.com/x.json', redirect_uris: ['https://cimd.example.com/cb'] })
    const res = await build().server.authorize(
      oauthRequest(authorizeUrl(CIMD, clientPkce().challenge, 'https://cimd.example.com/cb'))
    )
    expect(res.status).toBe(400)
    expect(responseBody(res).error).toBe('invalid_client')
  })
})
