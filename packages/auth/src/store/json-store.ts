import { existsSync, readFileSync, writeFileSync } from 'fs'
import { AuthCodeData, ClientRegistration, OAuthStore, PendingAuthData, RefreshTokenData } from '../provider/store.js'

function withTtl<T extends { expiresAt: number }>(obj: Record<string, T>, key: string): T | undefined {
  const item = obj[key]
  if (!item) { return undefined }
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
}

function writeJsonStore(path: string, store: JsonStore) {
  writeFileSync(path, JSON.stringify(store, null, 2), 'utf-8')
}

function readJsonStore(path: string): JsonStore {
  if (!existsSync(path)) {
    return {
      authCodes: {},
      pendingAuths: {},
      pkceVerifiers: {},
      clients: {},
      refreshTokens: {}
    }
  }
  const data = JSON.parse(readFileSync(path, 'utf-8'))
  if (!data.refreshTokens) { data.refreshTokens = {} }
  return data
}

export function createJsonStore(path: string): OAuthStore {
  const store: JsonStore = readJsonStore(path)

  return {
    async saveAuthCode(code, data) {
      store.authCodes[code] = data
      writeJsonStore(path, store)
    },
    async getAuthCode(code) { return withTtl(store.authCodes, code) },
    async deleteAuthCode(code) {
      delete store.authCodes[code]
      writeJsonStore(path, store)
    },
    async savePendingAuth(state, data) {
      store.pendingAuths[state] = data
      writeJsonStore(path, store)
    },
    async getPendingAuth(state) { return withTtl(store.pendingAuths, state) },
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
      if (!item) { return undefined }
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
    async getClient(clientId) { return store.clients[clientId] },

    async saveRefreshToken(token, data) {
      store.refreshTokens[token] = data
      writeJsonStore(path, store)
    },
    async getRefreshToken(token) { return withTtl(store.refreshTokens, token) },
    async deleteRefreshToken(token) {
      delete store.refreshTokens[token]
      writeJsonStore(path, store)
    }
  }
}
