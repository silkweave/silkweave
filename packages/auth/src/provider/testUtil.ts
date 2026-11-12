// Shared helpers for the OAuth provider and store test suites (not shipped:
// tsdown builds only the package's explicit entries). One definition each,
// so the suites stay small and helper names do not collide across files.

import { createHash, randomBytes } from 'crypto'
import type { RedisClient } from '../store/redis-store.js'
import type { OAuthRequest, OAuthResponse } from './types.js'

export const REDIRECT = 'https://client.example.com/callback'

/** A GET (no body) or form POST request against the provider. */
export function oauthRequest(url: string, body?: Record<string, string>): OAuthRequest {
  return { method: body ? 'POST' : 'GET', url: new URL(url), headers: {}, body }
}

/** The JSON body of a provider response. */
export const responseBody = (res: OAuthResponse) => res.body as Record<string, string>

/** Client-side PKCE pair, as a real MCP client would generate. */
export function clientPkce(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString('base64url')
  return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') }
}

/** An in-memory Redis honoring `SET NX` and `GETDEL`, like the real thing. */
export function fakeRedis(): RedisClient & { keys: Map<string, string> } {
  const keys = new Map<string, string>()
  return {
    keys,
    async get(key) {
      return keys.get(key) ?? null
    },
    async set(key, value, options) {
      if (options?.nx && keys.has(key)) {
        return null
      }
      keys.set(key, value)
      return 'OK'
    },
    async del(key) {
      keys.delete(key)
    },
    async getdel(key) {
      const value = keys.get(key) ?? null
      keys.delete(key)
      return value
    }
  }
}
