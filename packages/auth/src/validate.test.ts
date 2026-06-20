import { createContext, SilkweaveContext } from '@silkweave/core'
import { describe, expect, it } from 'vitest'
import { AuthConfig, AuthInfo } from './types.js'
import { validateToken } from './validate.js'

const context: SilkweaveContext = createContext({ adapter: 'test' })

/** Build an `AuthConfig` whose `verifyToken` returns a fixed `AuthInfo` (or undefined). */
function configReturning(authInfo: AuthInfo | undefined, extra: Partial<AuthConfig> = {}): AuthConfig {
  return { verifyToken: async () => authInfo, resourceUrl: 'https://mcp.example.com', ...extra }
}

const bearer = (token = 'tok') => `Bearer ${token}`

describe('validateToken', () => {
  it('challenges with 401 when no token and auth is required', async () => {
    const result = await validateToken(null, configReturning(undefined), context)
    expect(result.auth).toBeUndefined()
    expect(result.error?.statusCode).toBe(401)
    expect(result.error?.body.error).toBe('missing_token')
    expect(result.error?.headers['WWW-Authenticate']).toContain('resource_metadata=')
  })

  it('passes through with no auth when not required and no token', async () => {
    const result = await validateToken(null, configReturning(undefined, { required: false }), context)
    expect(result).toEqual({})
  })

  it('returns the auth info for a valid token', async () => {
    const auth: AuthInfo = { token: 'tok', aud: 'https://mcp.example.com', scopes: ['read'] }
    const result = await validateToken(bearer(), configReturning(auth), context)
    expect(result.auth).toBe(auth)
    expect(result.error).toBeUndefined()
  })

  it('rejects an expired token', async () => {
    const auth: AuthInfo = { token: 'tok', expiresAt: Date.now() / 1000 - 60 }
    const result = await validateToken(bearer(), configReturning(auth, { audience: false }), context)
    expect(result.error?.statusCode).toBe(401)
    expect(result.error?.body.error_description).toBe('Token has expired')
  })

  describe('audience binding (RFC 8707 / SEP-2352)', () => {
    it('rejects a token whose aud targets a different resource', async () => {
      const auth: AuthInfo = { token: 'tok', aud: 'https://other.example.com' }
      const result = await validateToken(bearer(), configReturning(auth), context)
      expect(result.error?.statusCode).toBe(401)
      expect(result.error?.body.error_description).toBe('Token audience mismatch')
    })

    it('accepts a token whose aud array includes the resource', async () => {
      const auth: AuthInfo = { token: 'tok', aud: ['https://other.example.com', 'https://mcp.example.com'] }
      const result = await validateToken(bearer(), configReturning(auth), context)
      expect(result.auth).toBe(auth)
    })

    it('allows a token with no aud claim (lenient default)', async () => {
      const auth: AuthInfo = { token: 'tok' }
      const result = await validateToken(bearer(), configReturning(auth), context)
      expect(result.auth).toBe(auth)
    })

    it('skips the check when audience is false', async () => {
      const auth: AuthInfo = { token: 'tok', aud: 'https://other.example.com' }
      const result = await validateToken(bearer(), configReturning(auth, { audience: false }), context)
      expect(result.auth).toBe(auth)
    })
  })

  describe('issuer binding (RFC 9207 / SEP-2468)', () => {
    it('rejects a token from an unexpected issuer', async () => {
      const auth: AuthInfo = { token: 'tok', iss: 'https://evil.example.com', aud: 'https://mcp.example.com' }
      const result = await validateToken(bearer(), configReturning(auth, { issuer: 'https://idp.example.com' }), context)
      expect(result.error?.body.error_description).toBe('Token issuer mismatch')
    })

    it('accepts a token from the expected issuer', async () => {
      const auth: AuthInfo = { token: 'tok', iss: 'https://idp.example.com', aud: 'https://mcp.example.com' }
      const result = await validateToken(bearer(), configReturning(auth, { issuer: 'https://idp.example.com' }), context)
      expect(result.auth).toBe(auth)
    })
  })

  describe('step-up scope challenge (SEP-2350)', () => {
    it('returns 403 with the required scopes in WWW-Authenticate', async () => {
      const auth: AuthInfo = { token: 'tok', aud: 'https://mcp.example.com', scopes: ['read'] }
      const result = await validateToken(bearer(), configReturning(auth, { requiredScopes: ['read', 'write'] }), context)
      expect(result.error?.statusCode).toBe(403)
      expect(result.error?.body.error).toBe('insufficient_scope')
      expect(result.error?.headers['WWW-Authenticate']).toContain('scope="read write"')
    })

    it('passes when all required scopes are present', async () => {
      const auth: AuthInfo = { token: 'tok', aud: 'https://mcp.example.com', scopes: ['read', 'write'] }
      const result = await validateToken(bearer(), configReturning(auth, { requiredScopes: ['read', 'write'] }), context)
      expect(result.auth).toBe(auth)
    })
  })
})
