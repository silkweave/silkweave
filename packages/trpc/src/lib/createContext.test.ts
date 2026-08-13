import { AuthConfig, AuthInfo } from '@silkweave/auth'
import { createContext, SilkweaveContext, SilkweaveError } from '@silkweave/core'
import { TRPCError } from '@trpc/server'
import { describe, expect, it } from 'vitest'
import { resolveIdentity, type Authenticate } from './createContext.js'

const context: SilkweaveContext = createContext({ adapter: 'test' })

const bearerAuth: AuthConfig = {
  verifyToken: async (token) => (token === 'good' ? { token, clientId: 'agent' } : undefined),
  resourceUrl: 'https://mcp.example.com',
  audience: false
}

const session: AuthInfo = { token: 'sess-1', clientId: 'user-7' }

const req = { headers: {} } as unknown as Request

describe('resolveIdentity', () => {
  it('uses the AuthInfo the resolver returns', async () => {
    const authenticate: Authenticate<Request> = () => session
    const result = await resolveIdentity(authenticate, undefined, req, null, context)
    expect(result).toEqual({ kind: 'ok', authInfo: session })
  })

  it('awaits an async resolver', async () => {
    const authenticate: Authenticate<Request> = async () => session
    const result = await resolveIdentity(authenticate, undefined, req, null, context)
    expect((result as { authInfo: AuthInfo }).authInfo).toBe(session)
  })

  it('falls through to the bearer path when the resolver declines', async () => {
    // One endpoint serving a cookie-bearing browser and a token-bearing agent.
    const authenticate: Authenticate<Request> = () => null
    const result = await resolveIdentity(authenticate, bearerAuth, req, 'Bearer good', context)
    expect(result.kind).toBe('ok')
    expect((result as { authInfo: AuthInfo }).authInfo.clientId).toBe('agent')
  })

  it('surfaces the bearer challenge when the fallthrough also fails', async () => {
    const authenticate: Authenticate<Request> = () => null
    const result = await resolveIdentity(authenticate, bearerAuth, req, 'Bearer bad', context)
    expect(result.kind).toBe('error')
    expect((result as { error: { statusCode: number } }).error.statusCode).toBe(401)
  })

  it('401s without a bearer challenge when the resolver declines and no auth is configured', async () => {
    // Advertising OAuth discovery on a cookie-only endpoint would mislead.
    const authenticate: Authenticate<Request> = () => null
    const result = await resolveIdentity(authenticate, undefined, req, null, context)
    expect(result.kind).toBe('error')
    const { error } = result as { error: { statusCode: number; headers: Record<string, string> } }
    expect(error.statusCode).toBe(401)
    expect(error.headers['WWW-Authenticate']).toBeUndefined()
  })

  it('maps a thrown SilkweaveError to a TRPCError with the right code', async () => {
    // A raw throw out of createContext is swallowed by @trpc/server and would
    // surface as an opaque 500.
    const authenticate: Authenticate<Request> = () => { throw new SilkweaveError('nope', 'forbidden', 403) }
    await expect(resolveIdentity(authenticate, undefined, req, null, context)).rejects.toSatisfy(
      (error: unknown) => error instanceof TRPCError && error.code === 'FORBIDDEN'
    )
  })

  it('maps an unexpected throw to INTERNAL_SERVER_ERROR', async () => {
    const authenticate: Authenticate<Request> = () => { throw new Error('db down') }
    await expect(resolveIdentity(authenticate, undefined, req, null, context)).rejects.toSatisfy(
      (error: unknown) => error instanceof TRPCError && error.code === 'INTERNAL_SERVER_ERROR'
    )
  })

  it('is the plain bearer path when no resolver is configured', async () => {
    const result = await resolveIdentity(undefined, bearerAuth, req, 'Bearer good', context)
    expect((result as { authInfo: AuthInfo }).authInfo.clientId).toBe('agent')
  })

  it('resolves anonymously when neither is configured', async () => {
    expect(await resolveIdentity(undefined, undefined, req, null, context)).toEqual({ kind: 'ok' })
  })
})

describe('context key parity', () => {
  it('puts the resolver AuthInfo under the same key the MCP path uses', async () => {
    // The whole feature rests on this: an action's context.get('auth') must be
    // identical whichever adapter called it. A different key would throw
    // "Invalid context key: auth" under one transport and work under the other.
    const authenticate: Authenticate<Request> = () => session
    const resolved = await resolveIdentity(authenticate, undefined, req, null, context)
    const forked = context.fork({ ...(resolved.kind === 'ok' && resolved.authInfo ? { auth: resolved.authInfo } : {}) })
    expect(forked.get<AuthInfo>('auth')).toBe(session)
  })
})
