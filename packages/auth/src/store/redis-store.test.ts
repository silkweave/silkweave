import { describe, expect, it } from 'vitest'
import { fakeRedis } from '../provider/testUtil.js'
import { createRedisStore } from './redis-store.js'

const refreshRecord = (grantId?: string) => ({
  clientId: 'c',
  scopes: [],
  sub: 'u',
  ...(grantId ? { grantId } : {}),
  expiresAt: Date.now() / 1000 + 3600
})

describe('createRedisStore - revokeGrant', () => {
  it('deletes every refresh token of the grant and only that grant', async () => {
    const client = fakeRedis()
    const store = createRedisStore({ client })
    await store.saveRefreshToken('t1', refreshRecord('g1'))
    await store.saveRefreshToken('t2', refreshRecord('g1'))
    await store.saveRefreshToken('t1', { ...refreshRecord('g1'), rotatedAt: 1 }) // re-save does not duplicate
    await store.saveRefreshToken('t3', refreshRecord('g2'))
    await store.saveRefreshToken('t4', refreshRecord())

    await store.revokeGrant!('g1')

    expect(await store.getRefreshToken('t1')).toBeUndefined()
    expect(await store.getRefreshToken('t2')).toBeUndefined()
    expect(await store.getRefreshToken('t3')).toBeDefined()
    expect(await store.getRefreshToken('t4')).toBeDefined()
    expect(client.keys.has('silkweave:oauth:grant:g1')).toBe(false)
  })
})
