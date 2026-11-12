import { chmodSync, existsSync, readFileSync, writeFileSync } from 'fs'
import { AuthCodeData, ClientRegistration, OAuthStore, PendingAuthData, RefreshTokenData } from '../provider/store.js'

function withTtl<T extends { expiresAt: number }>(obj: Record<string, T>, key: string): T | undefined {
  const item = obj[key]
  if (!item) {
    return undefined
  }
  if (item.expiresAt < Date.now() / 1000) {
    delete obj[key]
    return undefined
  }
  return item
}

interface JsonStore {
  authCodes: Record<string, AuthCodeData>
  pendingAuths: Record<string, PendingAuthData>
  pkceVerifiers: Record<string, { verifier: string; expiresAt: number }>
  clients: Record<string, ClientRegistration>
  refreshTokens: Record<string, RefreshTokenData>
  /** Revoked grant ids (durable tombstones), with the revocation time. */
  revokedGrants: Record<string, number>
}

/** Drop expired entries - rotated refresh records are kept for replay detection until their absolute expiry. */
function sweepExpired<T extends { expiresAt: number }>(obj: Record<string, T>): void {
  const now = Date.now() / 1000
  for (const [key, item] of Object.entries(obj)) {
    if (item.expiresAt < now) {
      delete obj[key]
    }
  }
}

function writeJsonStore(path: string, store: JsonStore) {
  // The store holds client secrets, refresh tokens, upstream access/ID tokens
  // and PKCE verifiers in plaintext - keep it owner-only (0600), not the default
  // 0644. `mode` only applies on creation, so also chmod an existing file.
  writeFileSync(path, JSON.stringify(store, null, 2), { encoding: 'utf-8', mode: 0o600 })
  chmodSync(path, 0o600)
}

function readJsonStore(path: string): JsonStore {
  if (!existsSync(path)) {
    return {
      authCodes: {},
      pendingAuths: {},
      pkceVerifiers: {},
      clients: {},
      refreshTokens: {},
      revokedGrants: {}
    }
  }
  const data = JSON.parse(readFileSync(path, 'utf-8'))
  if (!data.refreshTokens) {
    data.refreshTokens = {}
  }
  if (!data.revokedGrants) {
    data.revokedGrants = {}
  }
  return data
}

export function createJsonStore(path: string): OAuthStore {
  const store: JsonStore = readJsonStore(path)

  return {
    async saveAuthCode(code, data) {
      store.authCodes[code] = data
      writeJsonStore(path, store)
    },
    async getAuthCode(code) {
      return withTtl(store.authCodes, code)
    },
    async deleteAuthCode(code) {
      delete store.authCodes[code]
      writeJsonStore(path, store)
    },
    async savePendingAuth(state, data) {
      store.pendingAuths[state] = data
      writeJsonStore(path, store)
    },
    async getPendingAuth(state) {
      return withTtl(store.pendingAuths, state)
    },
    async deletePendingAuth(state) {
      delete store.pendingAuths[state]
      writeJsonStore(path, store)
    },
    async savePkceVerifier(state, verifier) {
      store.pkceVerifiers[state] = { verifier, expiresAt: Date.now() / 1000 + 600 }
      writeJsonStore(path, store)
    },
    async getPkceVerifier(state) {
      const item = store.pkceVerifiers[state]
      if (!item) {
        return undefined
      }
      if (item.expiresAt < Date.now() / 1000) {
        delete store.pkceVerifiers[state]
        writeJsonStore(path, store)
        return undefined
      }
      return item.verifier
    },
    async deletePkceVerifier(state) {
      delete store.pkceVerifiers[state]
      writeJsonStore(path, store)
    },
    async saveClient(clientId, data) {
      store.clients[clientId] = data
      writeJsonStore(path, store)
    },
    async getClient(clientId) {
      return store.clients[clientId]
    },

    async saveRefreshToken(token, data) {
      sweepExpired(store.refreshTokens)
      store.refreshTokens[token] = data
      writeJsonStore(path, store)
    },
    async getRefreshToken(token) {
      return withTtl(store.refreshTokens, token)
    },
    async deleteRefreshToken(token) {
      delete store.refreshTokens[token]
      writeJsonStore(path, store)
    },
    // Atomic within the process: no await between read and write.
    async takeAuthCode(code) {
      const data = withTtl(store.authCodes, code)
      delete store.authCodes[code]
      writeJsonStore(path, store)
      return data
    },
    async takePendingAuth(state) {
      const data = withTtl(store.pendingAuths, state)
      delete store.pendingAuths[state]
      writeJsonStore(path, store)
      return data
    },
    async rotateRefreshToken(token, rotation) {
      const data = withTtl(store.refreshTokens, token)
      if (!data || data.rotatedAt !== undefined) {
        return data
      }
      const rotated = { ...data, ...rotation }
      store.refreshTokens[token] = rotated
      writeJsonStore(path, store)
      return rotated
    },
    async isGrantRevoked(grantId) {
      return grantId in store.revokedGrants
    },
    async revokeGrant(grantId) {
      store.revokedGrants[grantId] = Date.now() / 1000
      for (const [token, data] of Object.entries(store.refreshTokens)) {
        if (data.grantId === grantId) {
          delete store.refreshTokens[token]
        }
      }
      writeJsonStore(path, store)
    }
  }
}
