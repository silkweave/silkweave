import { createContext } from '@silkweave/core'
import { describe, expect, it } from 'vitest'
import {
  normalizeResourceUri,
  pathResolver,
  protectedResourceMetadataUrl,
  resolveResourceUrl,
  resourcePathSuffix,
  toResourceRequest
} from './resolve.js'
import { AuthConfig } from './types.js'

const verifyToken = async () => undefined

describe('normalizeResourceUri', () => {
  it.each([
    // The classic bug: SDKs ship `new URL(resource)` stringifications, so a bare
    // origin arrives with a trailing slash while configs are written without one.
    ['https://mcp.example.com/', 'https://mcp.example.com'],
    ['https://mcp.example.com', 'https://mcp.example.com'],
    ['HTTPS://MCP.Example.COM', 'https://mcp.example.com'],
    ['https://mcp.example.com:443', 'https://mcp.example.com'],
    ['http://mcp.example.com:80', 'http://mcp.example.com'],
    ['https://mcp.example.com:8443', 'https://mcp.example.com:8443'],
    // Path case is preserved - tenant ids are case-sensitive identifiers.
    ['https://mcp.example.com/YoExOeXl', 'https://mcp.example.com/YoExOeXl'],
    // A trailing slash on a non-root path is significant; resolver and AS must agree.
    ['https://mcp.example.com/tenant/', 'https://mcp.example.com/tenant/']
  ])('normalizes %s -> %s', (input, expected) => {
    expect(normalizeResourceUri(input)).toBe(expected)
  })

  it.each([
    ['not-a-uri'],
    ['/relative/path'],
    // RFC 8707 §2: the resource URI must not include a fragment.
    ['https://mcp.example.com/tenant#frag']
  ])('rejects %s', (input) => {
    expect(normalizeResourceUri(input)).toBeUndefined()
  })
})

describe('protectedResourceMetadataUrl', () => {
  it('uses RFC 9728 path-insertion form for a path resource', () => {
    expect(protectedResourceMetadataUrl('https://mcp.example.com/yoexoexl'))
      .toBe('https://mcp.example.com/.well-known/oauth-protected-resource/yoexoexl')
  })

  it('collapses to the bare well-known path for an origin resource', () => {
    expect(protectedResourceMetadataUrl('https://mcp.example.com'))
      .toBe('https://mcp.example.com/.well-known/oauth-protected-resource')
  })

  it('preserves nested paths', () => {
    expect(protectedResourceMetadataUrl('https://mcp.example.com/a/b'))
      .toBe('https://mcp.example.com/.well-known/oauth-protected-resource/a/b')
  })
})

describe('resourcePathSuffix', () => {
  it('is empty for an origin resource', () => {
    expect(resourcePathSuffix('https://mcp.example.com')).toBe('')
  })

  it('is the pathname for a path resource', () => {
    expect(resourcePathSuffix('https://mcp.example.com/a/b')).toBe('/a/b')
  })
})

describe('toResourceRequest', () => {
  it('normalizes a Fetch Request', () => {
    const request = new Request('https://mcp.example.com/yoexoexl', { headers: { 'X-Trace': 'abc' } })
    const result = toResourceRequest(createContext({ request }))
    expect(result?.url.pathname).toBe('/yoexoexl')
    expect(result?.headers['x-trace']).toBe('abc')
  })

  it('normalizes an Express-shaped request via originalUrl + protocol + host', () => {
    const request = { originalUrl: '/yoexoexl', protocol: 'https', headers: { host: 'mcp.example.com' } }
    const result = toResourceRequest(createContext({ request }))
    expect(result?.url.toString()).toBe('https://mcp.example.com/yoexoexl')
  })

  it('normalizes a bare IncomingMessage using x-forwarded-proto', () => {
    const request = { url: '/yoexoexl', headers: { host: 'mcp.example.com', 'x-forwarded-proto': 'https, http' } }
    const result = toResourceRequest(createContext({ request }))
    expect(result?.url.toString()).toBe('https://mcp.example.com/yoexoexl')
  })

  it('defaults to http when nothing indicates the protocol', () => {
    const request = { url: '/x', headers: { host: 'mcp.example.com' } }
    expect(toResourceRequest(createContext({ request }))?.url.protocol).toBe('http:')
  })

  it('returns undefined with no request on the context', () => {
    expect(toResourceRequest(createContext({}))).toBeUndefined()
  })

  it('returns undefined when the origin cannot be reconstructed', () => {
    const request = { url: '/x', headers: {} }
    expect(toResourceRequest(createContext({ request }))).toBeUndefined()
  })
})

describe('resolveResourceUrl', () => {
  const base: AuthConfig = { verifyToken }

  it('passes a string config through unchanged', () => {
    const config = { ...base, resourceUrl: 'https://mcp.example.com' }
    expect(resolveResourceUrl(config, createContext({}))).toBe('https://mcp.example.com')
  })

  it('returns undefined when unset', () => {
    expect(resolveResourceUrl(base, createContext({}))).toBeUndefined()
  })

  it('invokes a resolver with the normalized request', () => {
    const config: AuthConfig = { ...base, resourceUrl: ({ url }) => `https://mcp.example.com${url.pathname}` }
    const request = new Request('https://spoofed.example.com/yoexoexl')
    expect(resolveResourceUrl(config, createContext({ request }))).toBe('https://mcp.example.com/yoexoexl')
  })

  it('returns undefined for a resolver with no request in context', () => {
    const config: AuthConfig = { ...base, resourceUrl: () => 'https://mcp.example.com/x' }
    expect(resolveResourceUrl(config, createContext({}))).toBeUndefined()
  })
})

describe('pathResolver', () => {
  const resolver = pathResolver({ origin: 'https://mcp.example.com', match: /^\/([a-z]{8})$/ })

  const requestFor = (url: string) => ({ url: new URL(url), headers: {} })

  it('builds the identifier from the configured origin, never the request origin', () => {
    // A spoofed Host must not steer the advertised metadata URL or the audience.
    expect(resolver(requestFor('https://evil.example.com/yoexoexl'), createContext({})))
      .toBe('https://mcp.example.com/yoexoexl')
  })

  it('returns undefined for a non-matching path', () => {
    expect(resolver(requestFor('https://mcp.example.com/resource/abc'), createContext({}))).toBeUndefined()
  })

  it('normalizes a trailing-slash origin', () => {
    const trailing = pathResolver({ origin: 'https://mcp.example.com/', match: /^\/([a-z]{8})$/ })
    expect(trailing(requestFor('https://mcp.example.com/yoexoexl'), createContext({})))
      .toBe('https://mcp.example.com/yoexoexl')
  })

  it('maps to the origin resource when a function match returns an empty string', () => {
    const total = pathResolver({
      origin: 'https://mcp.example.com',
      match: (pathname) => (/^\/([a-z]{8})$/.test(pathname) ? pathname : '')
    })
    expect(total(requestFor('https://mcp.example.com/mcp'), createContext({}))).toBe('https://mcp.example.com')
  })
})
