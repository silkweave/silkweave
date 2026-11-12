import type { OAuthStore, RefreshTokenData } from '../provider/store.js'

/**
 * The Redis commands the store needs (Upstash's client fits as-is). For the
 * atomic guarantees (single-use codes and consent, compare-and-set refresh
 * rotation) the adapter must honor `nx` (return `null` when the key exists, as
 * Redis `SET NX` does) and should provide `getdel` (Redis >= 6.2). Without
 * them the store still works, but those operations degrade to get-then-write.
 */
export interface RedisClient {
  get(key: string): Promise<unknown>
  set(key: string, value: string, options?: { ex?: number; nx?: boolean }): Promise<unknown>
  del(key: string): Promise<unknown>
  getdel?(key: string): Promise<unknown>
}

export interface RedisStoreOptions {
  client: RedisClient
  prefix?: string
}

export function createRedisStore(options: RedisStoreOptions): OAuthStore {
  const { client, prefix = 'silkweave:oauth:' } = options
  if (typeof client.getdel !== 'function') {
    console.warn(
      '[silkweave/auth] Redis client has no getdel(): authorization codes and consent requests are redeemed ' +
        'with non-atomic GET + DEL. Provide getdel (Redis >= 6.2) - and make sure set() honors { nx: true }.'
    )
  }

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
    if (ttl != null) {
      opts.ex = ttl
    }
    await client.set(key(namespace, id), JSON.stringify(data), opts)
  }

  async function load<T>(namespace: string, id: string): Promise<T | undefined> {
    const raw = await client.get(key(namespace, id))
    if (raw == null) {
      return undefined
    }
    return (typeof raw === 'string' ? JSON.parse(raw) : raw) as T
  }

  async function remove(namespace: string, id: string) {
    await client.del(key(namespace, id))
  }

  /** Atomic read-and-delete via GETDEL when available. */
  async function take<T>(namespace: string, id: string): Promise<T | undefined> {
    if (!client.getdel) {
      const value = await load<T>(namespace, id)
      await remove(namespace, id)
      return value
    }
    const raw = await client.getdel(key(namespace, id))
    if (raw == null) {
      return undefined
    }
    return (typeof raw === 'string' ? JSON.parse(raw) : raw) as T
  }

  return {
    async saveAuthCode(code, data) {
      await save('auth-code', code, data, data.expiresAt)
    },
    async getAuthCode(code) {
      return load('auth-code', code)
    },
    async deleteAuthCode(code) {
      await remove('auth-code', code)
    },

    async savePendingAuth(state, data) {
      await save('pending-auth', state, data, data.expiresAt)
    },
    async getPendingAuth(state) {
      return load('pending-auth', state)
    },
    async deletePendingAuth(state) {
      await remove('pending-auth', state)
    },

    async savePkceVerifier(state, verifier) {
      const expiresAt = Date.now() / 1000 + 600
      await save('pkce-verifier', state, { verifier, expiresAt }, expiresAt)
    },
    async getPkceVerifier(state) {
      const item = await load<{ verifier: string; expiresAt: number }>('pkce-verifier', state)
      return item?.verifier
    },
    async deletePkceVerifier(state) {
      await remove('pkce-verifier', state)
    },

    async saveClient(clientId, data) {
      await save('client', clientId, data)
    },
    async getClient(clientId) {
      return load('client', clientId)
    },

    async saveRefreshToken(token, data) {
      await save('refresh-token', token, data, data.expiresAt)
      // Index the grant's tokens (the client has no SCAN) so revokeGrant can
      // delete every rotation. The read-modify-write can drop a member under
      // concurrent saves; that only leaks storage until expiry - the grant
      // tombstone (isGrantRevoked) is what makes a revoked chain unusable.
      // Rotation carries the absolute expiry over, so the index expires with it.
      if (data.grantId) {
        const tokens = (await load<string[]>('grant', data.grantId)) ?? []
        if (!tokens.includes(token)) {
          tokens.push(token)
          await save('grant', data.grantId, tokens, data.expiresAt)
        }
      }
    },
    async getRefreshToken(token) {
      return load('refresh-token', token)
    },
    async deleteRefreshToken(token) {
      await remove('refresh-token', token)
    },
    async takeAuthCode(code) {
      return take('auth-code', code)
    },
    async takePendingAuth(state) {
      return take('pending-auth', state)
    },
    async rotateRefreshToken(token, rotation) {
      const data = await load<RefreshTokenData>('refresh-token', token)
      if (!data || data.rotatedAt !== undefined) {
        return data
      }
      // SET NX on a per-token marker decides the single winner of the rotation.
      const ttl = ttlFromExpiry(data.expiresAt)
      const won = await client.set(key('rotation', token), JSON.stringify(rotation), {
        nx: true,
        ...(ttl ? { ex: ttl } : {})
      })
      if (won == null) {
        const winner = await load<typeof rotation>('rotation', token)
        return winner ? { ...data, ...winner } : data
      }
      const rotated = { ...data, ...rotation }
      await save('refresh-token', token, rotated, data.expiresAt)
      return rotated
    },
    async isGrantRevoked(grantId) {
      return (await client.get(key('revoked-grant', grantId))) != null
    },
    async revokeGrant(grantId) {
      // Tombstone first, then delete: a refresh racing this revocation either
      // has its successor deleted below or sees the tombstone on its re-check.
      // No expiry: a tombstone must outlive every token of the grant, and the
      // chain's lifetime is not known here (the index may have lost members).
      await client.set(key('revoked-grant', grantId), '1')
      const tokens = (await load<string[]>('grant', grantId)) ?? []
      await Promise.all(tokens.map((token) => remove('refresh-token', token)))
      await remove('grant', grantId)
    }
  }
}
