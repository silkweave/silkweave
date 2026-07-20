import { binary, createContext, resource, type Action } from '@silkweave/core'
import { describe, expect, it } from 'vitest'
import { z } from 'zod/v4'
import { buildRouter } from './buildRouter.js'

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47])

function caller(actions: Action[]) {
  const router = buildRouter(actions)
  return router.createCaller({ silkweaveContext: createContext() })
}

function action(overrides: Partial<Action>): Action {
  return {
    name: 'take.screenshot',
    description: 'Take a screenshot',
    input: z.object({ url: z.string() }),
    output: binary({ mimeType: 'image/png' }),
    run: async () => resource(PNG, { mimeType: 'image/png', name: 'shot.png', description: 'a screenshot' }),
    ...overrides
  } as Action
}

describe('buildRouter resource results', () => {
  it('serializes a binary resource to a base64 envelope', async () => {
    const result = await (caller([action({})]) as never as { takeScreenshot: (input: object) => Promise<unknown> })
      .takeScreenshot({ url: 'https://example.com' })
    expect(result).toEqual({
      kind: 'resource',
      mimeType: 'image/png',
      name: 'shot.png',
      description: 'a screenshot',
      base64: Buffer.from(PNG).toString('base64')
    })
  })

  it('serializes a text resource with text instead of base64', async () => {
    const md = action({ run: async () => resource('# report', { mimeType: 'text/markdown' }) })
    const result = await (caller([md]) as never as { takeScreenshot: (input: object) => Promise<unknown> })
      .takeScreenshot({ url: 'x' })
    expect(result).toEqual({ kind: 'resource', mimeType: 'text/markdown', text: '# report' })
  })

  it('normalizes bare bytes using the binary() schema mime type', async () => {
    const bare = action({ run: async () => PNG })
    const result = await (caller([bare]) as never as { takeScreenshot: (input: object) => Promise<{ mimeType: string; base64: string }> })
      .takeScreenshot({ url: 'x' })
    expect(result.mimeType).toBe('image/png')
    expect(result.base64).toBe(Buffer.from(PNG).toString('base64'))
  })

  it('leaves plain JSON results untouched', async () => {
    const plain = action({ output: undefined, run: async () => ({ ok: true }) })
    const result = await (caller([plain]) as never as { takeScreenshot: (input: object) => Promise<unknown> })
      .takeScreenshot({ url: 'x' })
    expect(result).toEqual({ ok: true })
  })
})
