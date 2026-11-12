// Interleavings from the 7.2 security review (SW-Review): single-use codes and
// consent under parallel calls, grace-window reuse that must not fork a refresh
// family, revocation racing an in-flight refresh, and subject resolution.

import { mkdtempSync, readFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { decodeJwt } from 'jose'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createJsonStore } from '../store/json-store.js'
import { createMemoryStore } from '../store/memory-store.js'
import { createRedisStore } from '../store/redis-store.js'
import { createOAuthProxy } from './proxy.js'
import { createOAuthServer, OAuthServerConfig } from './server.js'
import { OAuthStore } from './store.js'
import { clientPkce, fakeRedis, oauthRequest, REDIRECT, responseBody } from './testUtil.js'

const appUrl = (path = ''): string => `https://app.example.com/mcp${path}`

function serverWith(store: OAuthStore, overrides: Partial<OAuthServerConfig> = {}) {
  const ids: string[] = []
  const server = createOAuthServer({
    resourceUrl: appUrl(),
    redirectUris: [REDIRECT],
    signingKey: 'concurrency-test-signing-key',
    store,
    onAuthorize: (pending) => {
      ids.push(pending.id)
      return `https://app.example.com/connect?request=${pending.id}`
    },
    ...overrides
  })
  return { server, ids }
}

async function pendingRequest(ctx: ReturnType<typeof serverWith>) {
  const reg = await ctx.server.register(
    oauthRequest(appUrl('/register'), { redirect_uris: JSON.stringify([REDIRECT]) })
  )
  const clientId = responseBody(reg).client_id
  const p = clientPkce()
  const url = new URL(appUrl('/authorize'))
  for (const [k, v] of Object.entries({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: REDIRECT,
    code_challenge: p.challenge,
    code_challenge_method: 'S256'
  })) {
    url.searchParams.set(k, v)
  }
  await ctx.server.authorize(oauthRequest(url.toString()))
  return { clientId, verifier: p.verifier, id: ctx.ids.at(-1)! }
}

async function connectAlice(ctx: ReturnType<typeof serverWith>) {
  const { clientId, verifier, id } = await pendingRequest(ctx)
  const approved = await ctx.server.approve(id, { sub: 'alice' })
  const code = new URL(approved!.redirectTo).searchParams.get('code')!
  const token = await ctx.server.token(
    oauthRequest(appUrl('/token'), {
      grant_type: 'authorization_code',
      code,
      code_verifier: verifier,
      client_id: clientId
    })
  )
  return { clientId, token: responseBody(token) }
}

const refreshWith = (ctx: ReturnType<typeof serverWith>, rt: string, clientId: string) =>
  ctx.server.token(
    oauthRequest(appUrl('/token'), { grant_type: 'refresh_token', refresh_token: rt, client_id: clientId })
  )

const stores: [string, () => OAuthStore][] = [
  ['memory', () => createMemoryStore()],
  ['json', () => createJsonStore(join(mkdtempSync(join(tmpdir(), 'sw-oauth-')), 'store.json'))],
  ['redis', () => createRedisStore({ client: fakeRedis() })]
]

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe.each(stores)('single use under concurrency (%s store)', (_name, makeStore) => {
  it('two parallel approvals of one consent request yield one code', async () => {
    const ctx = serverWith(makeStore())
    const { id } = await pendingRequest(ctx)
    const results = await Promise.all([
      ctx.server.approve(id, { sub: 'alice' }),
      ctx.server.approve(id, { sub: 'bob' })
    ])
    expect(results.filter(Boolean)).toHaveLength(1)
  })

  it('approve and deny cannot both succeed', async () => {
    const ctx = serverWith(makeStore())
    const { id } = await pendingRequest(ctx)
    const results = await Promise.all([ctx.server.approve(id, { sub: 'alice' }), ctx.server.deny(id)])
    expect(results.filter(Boolean)).toHaveLength(1)
  })

  it('two parallel redemptions of one code mint once', async () => {
    const ctx = serverWith(makeStore())
    const { clientId, verifier, id } = await pendingRequest(ctx)
    const code = new URL((await ctx.server.approve(id, { sub: 'alice' }))!.redirectTo).searchParams.get('code')!
    const exchange = () =>
      ctx.server.token(
        oauthRequest(appUrl('/token'), {
          grant_type: 'authorization_code',
          code,
          code_verifier: verifier,
          client_id: clientId
        })
      )
    const statuses = (await Promise.all([exchange(), exchange()])).map((r) => r.status).sort()
    expect(statuses).toEqual([200, 400])
  })

  it('two parallel first refreshes continue ONE chain (same successor)', async () => {
    const ctx = serverWith(makeStore())
    const { clientId, token } = await connectAlice(ctx)
    const [a, b] = await Promise.all([
      refreshWith(ctx, token.refresh_token, clientId),
      refreshWith(ctx, token.refresh_token, clientId)
    ])
    expect(a.status).toBe(200)
    expect(b.status).toBe(200)
    expect(responseBody(a).refresh_token).toBe(responseBody(b).refresh_token)
  })
})

describe.each(stores)('grace window does not fork the family (%s store)', (_name, makeStore) => {
  it('a reuse inside the grace window returns the same successor', async () => {
    const ctx = serverWith(makeStore())
    const { clientId, token } = await connectAlice(ctx)
    const first = await refreshWith(ctx, token.refresh_token, clientId)
    const reuse = await refreshWith(ctx, token.refresh_token, clientId)
    expect(responseBody(reuse).refresh_token).toBe(responseBody(first).refresh_token)
  })

  it('a thief reusing R0 in the grace window shares the chain and trips replay detection', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    const ctx = serverWith(makeStore())
    const { clientId, token } = await connectAlice(ctx)
    const legit = await refreshWith(ctx, token.refresh_token, clientId) // R0 -> R1
    const thief = await refreshWith(ctx, token.refresh_token, clientId) // R0 again, inside grace
    expect(responseBody(thief).refresh_token).toBe(responseBody(legit).refresh_token) // no independent branch
    vi.setSystemTime(Date.now() + 31_000)
    const legitNext = await refreshWith(ctx, responseBody(legit).refresh_token, clientId) // R1 -> R2
    expect(legitNext.status).toBe(200)
    vi.setSystemTime(Date.now() + 31_000)
    const thiefNext = await refreshWith(ctx, responseBody(thief).refresh_token, clientId) // R1 replayed after grace
    expect(thiefNext.status).toBe(400)
    // The whole family is revoked: the legitimate successor dies too.
    expect((await refreshWith(ctx, responseBody(legitNext).refresh_token, clientId)).status).toBe(400)
  })
})

describe('revocation cannot be undone by an in-flight refresh', () => {
  it('a refresh paused before saving its successor fails once a replay revoked the grant', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    const inner = createMemoryStore()
    let gate: Promise<void> | undefined
    let release!: () => void
    let paused!: () => void
    const reachedSave = new Promise<void>((resolve) => (paused = resolve))
    const store: OAuthStore = {
      ...inner,
      async saveRefreshToken(token, data) {
        if (gate && data.rotatedAt === undefined) {
          paused()
          await gate
        }
        return inner.saveRefreshToken(token, data)
      }
    }
    const ctx = serverWith(store)
    const { clientId, token } = await connectAlice(ctx)
    const r1 = responseBody(await refreshWith(ctx, token.refresh_token, clientId)).refresh_token // R0 -> R1
    vi.setSystemTime(Date.now() + 31_000)

    gate = new Promise<void>((resolve) => (release = resolve))
    const inFlight = refreshWith(ctx, r1, clientId) // pauses before saving R2
    await reachedSave
    const replay = await refreshWith(ctx, token.refresh_token, clientId) // R0 after grace -> revoke
    expect(replay.status).toBe(400)
    release()
    const resumed = await inFlight
    expect(resumed.status).toBe(400)
    expect(await inner.isGrantRevoked!(decodeJwt(token.access_token).grant_id as string)).toBe(true)
  })

  it('a refresh token the redis index lost is still dead after revocation (tombstone)', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    const store = createRedisStore({ client: fakeRedis() })
    const ctx = serverWith(store)
    const { clientId, token } = await connectAlice(ctx)
    const r1 = responseBody(await refreshWith(ctx, token.refresh_token, clientId)).refresh_token
    const grantId = decodeJwt(token.access_token).grant_id as string
    // Simulate a token the grant index dropped under concurrent saves.
    const orphan = await store.getRefreshToken(r1)
    await store.saveRefreshToken('orphan-token', { ...orphan!, rotatedAt: undefined, next: undefined })
    await store.saveRefreshToken('orphan-token-2', { ...orphan!, grantId: 'other', rotatedAt: undefined })
    vi.setSystemTime(Date.now() + 31_000)
    await refreshWith(ctx, token.refresh_token, clientId) // replay -> revoke grantId
    expect(await store.isGrantRevoked!(grantId)).toBe(true)
    expect((await refreshWith(ctx, 'orphan-token', clientId)).status).toBe(400)
  })
})

describe('hardening', () => {
  it('fails closed with an OAuth error when isGrantActive throws', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const ctx = serverWith(createMemoryStore(), {
      isGrantActive: () => {
        throw new Error('db down')
      }
    })
    const { clientId, token } = await connectAlice(ctx)
    expect(await ctx.server.verifyToken(token.access_token)).toBeUndefined()
    const res = await refreshWith(ctx, token.refresh_token, clientId)
    expect(res.status).toBe(400)
    expect(responseBody(res).error).toBe('invalid_grant')
  })

  it('rejects redirect URIs carrying a fragment', async () => {
    const ctx = serverWith(createMemoryStore(), { redirectUris: ['https://client.example.com/*'] })
    const res = await ctx.server.register(
      oauthRequest(appUrl('/register'), { redirect_uris: JSON.stringify(['https://client.example.com/cb#frag']) })
    )
    expect(res.status).toBe(400)
  })

  it('warns once when a custom store lacks the atomic operations', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const {
      takeAuthCode: _a,
      takePendingAuth: _b,
      rotateRefreshToken: _c,
      isGrantRevoked: _d,
      revokeGrant: _e,
      ...weak
    } = createMemoryStore()
    serverWith(weak)
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0][0]).toContain('takeAuthCode')
  })

  it('sweeps expired refresh records from the JSON store', async () => {
    const path = join(mkdtempSync(join(tmpdir(), 'sw-oauth-')), 'store.json')
    const store = createJsonStore(path)
    const base = { clientId: 'c', scopes: [], sub: 'u' }
    await store.saveRefreshToken('expired', { ...base, expiresAt: Date.now() / 1000 - 10 })
    await store.saveRefreshToken('live', { ...base, expiresAt: Date.now() / 1000 + 3600 })
    const saved = JSON.parse(readFileSync(path, 'utf-8')).refreshTokens
    expect(Object.keys(saved)).toEqual(['live'])
  })
})

describe('proxy subject resolution', () => {
  it('an email-only upstream identity verifies AND refreshes with the same sub', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL) =>
        String(input).includes('/token')
          ? new Response(JSON.stringify({ access_token: 'upstream-at' }), { status: 200 })
          : new Response(JSON.stringify({ email: 'user@example.com' }), { status: 200 })
      )
    )
    const store = createMemoryStore()
    const seen: string[] = []
    const provider = createOAuthProxy({
      authorizeUrl: 'https://idp.example.com/authorize',
      tokenUrl: 'https://idp.example.com/token',
      userinfoUrl: 'https://idp.example.com/userinfo',
      clientId: 'up',
      clientSecret: 'up-secret',
      resourceUrl: appUrl(),
      redirectUris: [REDIRECT],
      signingKey: 'proxy-subject-test-key',
      store,
      isGrantActive: ({ sub }) => {
        seen.push(sub)
        return true
      }
    })
    await store.saveClient('c1', { clientId: 'c1', clientSecret: '', redirectUris: [REDIRECT], createdAt: 0 })
    const p = clientPkce()
    const url = new URL(appUrl('/authorize'))
    for (const [k, v] of Object.entries({
      response_type: 'code',
      client_id: 'c1',
      redirect_uri: REDIRECT,
      code_challenge: p.challenge,
      code_challenge_method: 'S256'
    })) {
      url.searchParams.set(k, v)
    }
    const authorized = await provider.authorize(oauthRequest(url.toString()))
    const state = new URL(authorized.headers.Location).searchParams.get('state')!
    const cb = await provider.callback(oauthRequest(`${appUrl('/auth/callback')}?code=up-code&state=${state}`))
    const code = new URL(cb.headers.Location).searchParams.get('code')!
    const token = responseBody(
      await provider.token(
        oauthRequest(appUrl('/token'), {
          grant_type: 'authorization_code',
          code,
          code_verifier: p.verifier,
          client_id: 'c1'
        })
      )
    )
    expect((await provider.verifyToken(token.access_token))?.sub).toBe('user@example.com')
    const refreshed = await provider.token(
      oauthRequest(appUrl('/token'), {
        grant_type: 'refresh_token',
        refresh_token: token.refresh_token,
        client_id: 'c1'
      })
    )
    expect(refreshed.status).toBe(200)
    expect(seen.every((sub) => sub === 'user@example.com')).toBe(true)
    vi.unstubAllGlobals()
  })
})
