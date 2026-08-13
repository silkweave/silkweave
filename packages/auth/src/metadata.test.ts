import { createContext, SilkweaveContext } from '@silkweave/core'
import { describe, expect, it } from 'vitest'
import { resolveProtectedResourceMetadata } from './metadata.js'
import { pathResolver } from './resolve.js'
import { AuthConfig, ResourceRequest } from './types.js'

const context: SilkweaveContext = createContext({ adapter: 'test' })

const auth: AuthConfig = {
  verifyToken: async () => undefined,
  resourceUrl: pathResolver({ origin: 'https://mcp.example.com', match: /^\/([a-z]{8})$/ }),
  authorizationServers: ['https://mcp.example.com'],
  requiredScopes: ['openid', 'email']
}

const requestFor = (path: string): ResourceRequest => ({
  url: new URL(`https://mcp.example.com${path}`),
  headers: {}
})

describe('resolveProtectedResourceMetadata', () => {
  it('serves the per-tenant document from the insertion-form path', () => {
    const metadata = resolveProtectedResourceMetadata(
      auth,
      requestFor('/.well-known/oauth-protected-resource/yoexoexl'),
      context
    )
    expect(metadata).toEqual({
      resource: 'https://mcp.example.com/yoexoexl',
      authorization_servers: ['https://mcp.example.com'],
      scopes_supported: ['openid', 'email'],
      bearer_methods_supported: ['header']
    })
  })

  it('round-trips the URL a challenge advertises', () => {
    // The challenge URL and the served route derive from the same helper, so
    // they cannot drift: whatever validateToken advertises must resolve here.
    const advertised = new URL('https://mcp.example.com/.well-known/oauth-protected-resource/kqwrmach')
    const metadata = resolveProtectedResourceMetadata(auth, { url: advertised, headers: {} }, context)
    expect(metadata?.resource).toBe('https://mcp.example.com/kqwrmach')
  })

  it('404s (undefined) for an unrecognized sub-resource', () => {
    expect(resolveProtectedResourceMetadata(
      auth,
      requestFor('/.well-known/oauth-protected-resource/not-a-tenant'),
      context
    )).toBeUndefined()
  })

  it('404s when the resolver answers a different path than was requested', () => {
    const drifting: AuthConfig = {
      ...auth,
      resourceUrl: () => 'https://mcp.example.com/elsewhere'
    }
    expect(resolveProtectedResourceMetadata(
      drifting,
      requestFor('/.well-known/oauth-protected-resource/yoexoexl'),
      context
    )).toBeUndefined()
  })

  it('returns undefined for a non-well-known path', () => {
    expect(resolveProtectedResourceMetadata(auth, requestFor('/yoexoexl'), context)).toBeUndefined()
  })

  it('returns undefined for a string resourceUrl (handled by the precomputed path)', () => {
    const stringConfig: AuthConfig = { ...auth, resourceUrl: 'https://mcp.example.com' }
    expect(resolveProtectedResourceMetadata(
      stringConfig,
      requestFor('/.well-known/oauth-protected-resource'),
      context
    )).toBeUndefined()
  })

  it('does not confuse a prefix-adjacent path for a sub-resource', () => {
    expect(resolveProtectedResourceMetadata(
      auth,
      requestFor('/.well-known/oauth-protected-resource-other'),
      context
    )).toBeUndefined()
  })
})
