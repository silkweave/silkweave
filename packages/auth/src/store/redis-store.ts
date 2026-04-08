import type { OAuthStore } from '../provider/store.js'

export interface RedisClient {
  get(key: string): Promise<unknown>
  set(key: string, value: string, options?: { ex?: number }): Promise<unknown>
  del(key: string): Promise<unknown>
}

export interface RedisStoreOptions {
  client: RedisClient
  prefix?: string
}

export function createRedisStore(options: RedisStoreOptions): OAuthStore {
  const { client, prefix = 'silkweave:oauth:' } = options

  function key(namespace: string, id: string) {
    return `${prefix}${namespace}:${id}`
  }

  function ttlFromExpiry(expiresAt: number): number | undefined {
    const seconds = Math.floor(expiresAt - Date.now() / 1000)
    return seconds > 0 ? seconds : undefined
  }

  async function save<T>(namespace: string, id: string, data: T, expiresAt?: number) {
    const opts: { ex?: number } = {}
    const ttl = expiresAt != null ? ttlFromExpiry(expiresAt) : undefined
    if (ttl != null) { opts.ex = ttl }
    await client.set(key(namespace, id), JSON.stringify(data), opts)
  }

  async function load<T>(namespace: string, id: string): Promise<T | undefined> {
    const raw = await client.get(key(namespace, id))
    if (raw == null) { return undefined }
    return (typeof raw === 'string' ? JSON.parse(raw) : raw) as T
  }

  async function remove(namespace: string, id: string) {
    await client.del(key(namespace, id))
  }

  return {
    async saveAuthCode(code, data) { await save('auth-code', code, data, data.expiresAt) },
    async getAuthCode(code) { return load('auth-code', code) },
    async deleteAuthCode(code) { await remove('auth-code', code) },

    async savePendingAuth(state, data) { await save('pending-auth', state, data, data.expiresAt) },
    async getPendingAuth(state) { return load('pending-auth', state) },
    async deletePendingAuth(state) { await remove('pending-auth', state) },

    async savePkceVerifier(state, verifier) {
      const expiresAt = Date.now() / 1000 + 600
      await save('pkce-verifier', state, { verifier, expiresAt }, expiresAt)
    },
    async getPkceVerifier(state) {
      const item = await load<{ verifier: string; expiresAt: number }>('pkce-verifier', state)
      return item?.verifier
    },
    async deletePkceVerifier(state) { await remove('pkce-verifier', state) },

    async saveClient(clientId, data) { await save('client', clientId, data) },
    async getClient(clientId) { return load('client', clientId) },

    async saveRefreshToken(token, data) { await save('refresh-token', token, data, data.expiresAt) },
    async getRefreshToken(token) { return load('refresh-token', token) },
    async deleteRefreshToken(token) { await remove('refresh-token', token) }
  }
}
