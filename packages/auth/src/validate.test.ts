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
      const result = await validateToken(
        bearer(),
        configReturning(auth, { issuer: 'https://idp.example.com' }),
        context
      )
      expect(result.error?.body.error_description).toBe('Token issuer mismatch')
    })

    it('accepts a token from the expected issuer', async () => {
      const auth: AuthInfo = { token: 'tok', iss: 'https://idp.example.com', aud: 'https://mcp.example.com' }
      const result = await validateToken(
        bearer(),
        configReturning(auth, { issuer: 'https://idp.example.com' }),
        context
      )
      expect(result.auth).toBe(auth)
    })
  })

  describe('per-request resource resolution', () => {
    const tenantResolver = ({ url }: { url: URL }) => {
      const match = /^\/([a-z]{8})$/.exec(url.pathname)
      return match ? `https://mcp.example.com/${match[1]}` : undefined
    }

    /** A context carrying a Fetch request, as every adapter forks it. */
    const at = (path: string) =>
      createContext({
        adapter: 'test',
        request: new Request(`https://mcp.example.com${path}`)
      })

    it('challenges with the RFC 9728 insertion-form metadata URL', async () => {
      const config = configReturning(undefined, { resourceUrl: tenantResolver })
      const result = await validateToken(null, config, at('/yoexoexl'))
      expect(result.error?.headers['WWW-Authenticate']).toContain(
        'resource_metadata="https://mcp.example.com/.well-known/oauth-protected-resource/yoexoexl"'
      )
    })

    it('rejects a token minted for another tenant (cross-resource replay)', async () => {
      const auth: AuthInfo = { token: 'tok', aud: 'https://mcp.example.com/yoexoexl' }
      const config = configReturning(auth, { resourceUrl: tenantResolver })
      const result = await validateToken(bearer(), config, at('/kqwrmach'))
      expect(result.error?.statusCode).toBe(401)
      expect(result.error?.body.error_description).toBe('Token audience mismatch')
    })

    it('accepts a token whose aud matches the resolved tenant', async () => {
      const auth: AuthInfo = { token: 'tok', aud: 'https://mcp.example.com/yoexoexl' }
      const config = configReturning(auth, { resourceUrl: tenantResolver })
      const result = await validateToken(bearer(), config, at('/yoexoexl'))
      expect(result.auth).toBe(auth)
      expect(result.resource).toBe('https://mcp.example.com/yoexoexl')
    })

    it('challenges without resource_metadata when the resolver does not match', async () => {
      const config = configReturning(undefined, { resourceUrl: tenantResolver })
      const result = await validateToken(null, config, at('/resource/abc'))
      expect(result.error?.headers['WWW-Authenticate']).not.toContain('resource_metadata=')
    })

    it('skips the default audience check on a resolver miss (fail-open, as today)', async () => {
      // Sideload and other guarded non-resource routes must keep working.
      const auth: AuthInfo = { token: 'tok', aud: 'https://mcp.example.com/yoexoexl' }
      const config = configReturning(auth, { resourceUrl: tenantResolver })
      const result = await validateToken(bearer(), config, at('/resource/abc'))
      expect(result.auth).toBe(auth)
      expect(result.resource).toBeUndefined()
    })

    it('still enforces an explicit audience on a resolver miss', async () => {
      const auth: AuthInfo = { token: 'tok', aud: 'https://mcp.example.com/yoexoexl' }
      const config = configReturning(auth, { resourceUrl: tenantResolver, audience: 'https://mcp.example.com' })
      const result = await validateToken(bearer(), config, at('/resource/abc'))
      expect(result.error?.body.error_description).toBe('Token audience mismatch')
    })

    it('keeps the append-form challenge URL for a string config', async () => {
      const result = await validateToken(null, configReturning(undefined), context)
      expect(result.error?.headers['WWW-Authenticate']).toContain(
        'resource_metadata="https://mcp.example.com/.well-known/oauth-protected-resource"'
      )
    })
  })

  describe('step-up scope challenge (SEP-2350)', () => {
    it('returns 403 with the required scopes in WWW-Authenticate', async () => {
      const auth: AuthInfo = { token: 'tok', aud: 'https://mcp.example.com', scopes: ['read'] }
      const result = await validateToken(
        bearer(),
        configReturning(auth, { requiredScopes: ['read', 'write'] }),
        context
      )
      expect(result.error?.statusCode).toBe(403)
      expect(result.error?.body.error).toBe('insufficient_scope')
      expect(result.error?.headers['WWW-Authenticate']).toContain('scope="read write"')
    })

    it('passes when all required scopes are present', async () => {
      const auth: AuthInfo = { token: 'tok', aud: 'https://mcp.example.com', scopes: ['read', 'write'] }
      const result = await validateToken(
        bearer(),
        configReturning(auth, { requiredScopes: ['read', 'write'] }),
        context
      )
      expect(result.auth).toBe(auth)
    })
  })
})
