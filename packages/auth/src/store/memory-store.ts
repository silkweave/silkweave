import { AuthCodeData, ClientRegistration, OAuthStore, PendingAuthData, RefreshTokenData } from '../provider/store.js'

function withTtl<T extends { expiresAt: number }>(map: Map<string, T>, key: string): T | undefined {
  const item = map.get(key)
  if (!item) { return undefined }
  if (item.expiresAt < Date.now() / 1000) {
    map.delete(key)
    return undefined
  }
  return item
}

export function createMemoryStore(): OAuthStore {
  const authCodes = new Map<string, AuthCodeData>()
  const pendingAuths = new Map<string, PendingAuthData>()
  const pkceVerifiers = new Map<string, { verifier: string; expiresAt: number }>()
  const clients = new Map<string, ClientRegistration>()
  const refreshTokens = new Map<string, RefreshTokenData>()

  return {
    async saveAuthCode(code, data) { authCodes.set(code, data) },
    async getAuthCode(code) { return withTtl(authCodes, code) },
    async deleteAuthCode(code) { authCodes.delete(code) },

    async savePendingAuth(state, data) { pendingAuths.set(state, data) },
    async getPendingAuth(state) { return withTtl(pendingAuths, state) },
    async deletePendingAuth(state) { pendingAuths.delete(state) },

    async savePkceVerifier(state, verifier) {
      pkceVerifiers.set(state, { verifier, expiresAt: Date.now() / 1000 + 600 })
    },
    async getPkceVerifier(state) {
      const item = pkceVerifiers.get(state)
      if (!item) { return undefined }
      if (item.expiresAt < Date.now() / 1000) {
        pkceVerifiers.delete(state)
        return undefined
      }
      return item.verifier
    },
    async deletePkceVerifier(state) { pkceVerifiers.delete(state) },

    async saveClient(clientId, data) { clients.set(clientId, data) },
    async getClient(clientId) { return clients.get(clientId) },

    async saveRefreshToken(token, data) { refreshTokens.set(token, data) },
    async getRefreshToken(token) { return withTtl(refreshTokens, token) },
    async deleteRefreshToken(token) { refreshTokens.delete(token) }
  }
}
