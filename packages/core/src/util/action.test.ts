import { describe, expect, it } from 'vitest'
import z from 'zod/v4'
import { createAction, validateActionDisposition, type Action } from './action.js'
import { SilkweaveError } from './error.js'

const base = {
  name: 'users.get',
  description: 'Get a user',
  input: z.object({ id: z.string() })
}

describe('validateActionDisposition', () => {
  it('accepts structured actions with an output schema', () => {
    const action = createAction({
      ...base,
      disposition: 'structured',
      output: z.object({ id: z.string() }),
      run: async ({ id }) => ({ id })
    })
    expect(() => validateActionDisposition(action as Action)).not.toThrow()
  })

  it('rejects structured actions without an output schema', () => {
    const action = createAction({ ...base, disposition: 'structured', run: async ({ id }) => ({ id }) })
    expect(() => validateActionDisposition(action as Action)).toThrow(SilkweaveError)
    expect(() => validateActionDisposition(action as Action)).toThrow(/requires an 'output' schema/)
  })

  it('rejects structured streaming actions', () => {
    const action: Action = {
      ...base,
      disposition: 'structured',
      output: z.object({ id: z.string() }),
      chunk: z.object({ id: z.string() }),
      run: async function* ({ id }: { id: string }) { yield { id } }
    } as Action
    expect(() => validateActionDisposition(action)).toThrow(/not supported on a streaming action/)
  })

  it('is a no-op for json, smart, and unset dispositions', () => {
    for (const disposition of ['json', 'smart', undefined] as const) {
      const action = createAction({ ...base, ...(disposition ? { disposition } : {}), run: async ({ id }) => ({ id }) })
      expect(() => validateActionDisposition(action as Action)).not.toThrow()
    }
  })
})
