import { describe, expect, it } from 'vitest'
import { assertSafeMetadataUrl } from './ssrf.js'

const ok = (url: string) => assertSafeMetadataUrl(url).ok

describe('assertSafeMetadataUrl', () => {
  it('allows a normal public https URL', () => {
    expect(ok('https://client.example.com/.well-known/oauth-client')).toBe(true)
    expect(ok('https://93.184.216.34/meta')).toBe(true) // a public IP literal
  })

  it('requires https', () => {
    expect(ok('http://client.example.com/meta')).toBe(false)
  })

  it('blocks the cloud metadata endpoint', () => {
    expect(ok('https://169.254.169.254/latest/meta-data/')).toBe(false)
  })

  it('blocks loopback', () => {
    expect(ok('https://127.0.0.1/x')).toBe(false)
    expect(ok('https://localhost/x')).toBe(false)
    expect(ok('https://foo.localhost/x')).toBe(false)
    expect(ok('https://[::1]/x')).toBe(false)
  })

  it('blocks private IPv4 ranges', () => {
    expect(ok('https://10.1.2.3/x')).toBe(false)
    expect(ok('https://172.16.5.5/x')).toBe(false)
    expect(ok('https://192.168.0.1/x')).toBe(false)
    expect(ok('https://100.64.0.1/x')).toBe(false)
  })

  it('blocks IPv6 unique-local and link-local', () => {
    expect(ok('https://[fd00::1]/x')).toBe(false)
    expect(ok('https://[fe80::1]/x')).toBe(false)
  })

  it('blocks IPv4-mapped IPv6 that resolves to a private v4', () => {
    expect(ok('https://[::ffff:10.0.0.1]/x')).toBe(false)
  })

  it('rejects an unparseable URL', () => {
    expect(ok('https://')).toBe(false)
  })
})
