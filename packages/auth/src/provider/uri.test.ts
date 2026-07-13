import { describe, expect, it } from 'vitest'
import { matchRedirectUri } from './uri.js'

describe('matchRedirectUri', () => {
  it('matches an exact redirect_uri', () => {
    expect(matchRedirectUri('https://app.com/cb', ['https://app.com/cb'])).toBe(true)
  })

  it('rejects a scheme mismatch', () => {
    expect(matchRedirectUri('http://app.com/cb', ['https://app.com/cb'])).toBe(false)
  })

  it('rejects a port that the pattern did not declare', () => {
    expect(matchRedirectUri('https://app.com:8443/cb', ['https://app.com/cb'])).toBe(false)
  })

  it('allows a trailing path wildcard', () => {
    expect(matchRedirectUri('https://claude.ai/oauth/callback', ['https://claude.ai/*'])).toBe(true)
    expect(matchRedirectUri('https://claude.ai/cb?state=1', ['https://claude.ai/*'])).toBe(true)
  })

  it('allows a subdomain wildcard for the intended host only', () => {
    expect(matchRedirectUri('https://app.example.com/callback', ['https://*.example.com/callback'])).toBe(true)
  })

  it('allows loopback patterns to span any port and path (RFC 8252)', () => {
    expect(matchRedirectUri('http://localhost:54321/callback', ['http://localhost:*'])).toBe(true)
    expect(matchRedirectUri('http://127.0.0.1:8080/cb', ['http://127.0.0.1:*'])).toBe(true)
  })

  describe('boundary-crossing attacks are rejected', () => {
    it('does not let a subdomain wildcard cross the host boundary via the path', () => {
      // host is attacker.com, not *.example.com
      expect(matchRedirectUri('https://attacker.com/x.example.com/callback', ['https://*.example.com/callback'])).toBe(false)
    })

    it('does not match a host suffix attack', () => {
      expect(matchRedirectUri('https://claude.ai.attacker.com/x', ['https://claude.ai/*'])).toBe(false)
    })

    it('rejects userinfo injection against a loopback pattern', () => {
      // real host is attacker.com; localhost/127.0.0.1 is only the username
      expect(matchRedirectUri('http://localhost:x@attacker.com/cb', ['http://localhost:*'])).toBe(false)
      expect(matchRedirectUri('http://127.0.0.1:x@evil.com/cb', ['http://127.0.0.1:*'])).toBe(false)
    })

    it('rejects userinfo when the pattern declares none', () => {
      expect(matchRedirectUri('https://user@app.com/cb', ['https://app.com/cb'])).toBe(false)
    })

    it('rejects an unparseable redirect_uri', () => {
      expect(matchRedirectUri('not a url', ['https://app.com/cb'])).toBe(false)
    })
  })
})
