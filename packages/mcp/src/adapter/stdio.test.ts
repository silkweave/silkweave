import { createContext, type Action } from '@silkweave/core'
import { describe, expect, it } from 'vitest'
import { z } from 'zod/v4'
import { stdio } from './stdio.js'

function action(name: string): Action {
  return { name, description: `${name} action`, input: z.object({}), run: async () => ({ ok: true }) } as Action
}

describe('stdio', () => {
  it('rejects start() when two actions collide on the same tool name', async () => {
    const adapter = stdio()({ name: 'test', description: 'test', version: '0.0.0' }, createContext())
    await expect(adapter.start([action('foo-bar'), action('foo_bar')])).rejects.toThrow(/FooBar/)
  })
})
