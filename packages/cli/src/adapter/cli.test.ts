import { createContext, type Action } from '@silkweave/core'
import { describe, expect, it } from 'vitest'
import z from 'zod/v4'
import { cli } from './cli.js'

/**
 * Parse `argv` through the adapter and resolve with the input the action's
 * `run` received. Commander reads `process.argv`, so it is swapped for the
 * duration of the parse.
 */
async function runCommand(base: Action, argv: string[]): Promise<object> {
  let resolveInput!: (input: object) => void
  const received = new Promise<object>((resolve) => {
    resolveInput = resolve
  })
  const wrapped = {
    ...base,
    run: async (input: object) => {
      resolveInput(input)
      return input
    }
  } as Action
  const adapter = cli()({ name: 'test-cli', description: 'test', version: '0.0.0', lint: false }, createContext())
  const originalArgv = process.argv
  process.argv = ['node', 'test-cli', ...argv]
  try {
    await adapter.start([wrapped])
  } finally {
    process.argv = originalArgv
  }
  return received
}

function action(overrides: Partial<Action>): Action {
  return {
    name: 'do.thing',
    description: 'Do a thing',
    input: z.object({}),
    run: async () => ({}),
    ...overrides
  } as Action
}

describe('cli option key mapping', () => {
  it('maps kebab-case flags back to snake_case input keys', async () => {
    const input = await runCommand(
      action({
        input: z.object({ action_id: z.string(), dry_run: z.boolean().optional() })
      }),
      ['do-thing', '--action-id', 'abc', '--dry-run']
    )
    expect(input).toEqual({ action_id: 'abc', dry_run: true })
  })

  it('maps kebab-case flags back to camelCase input keys', async () => {
    const input = await runCommand(
      action({
        input: z.object({ spaceId: z.string(), limit: z.number().optional() })
      }),
      ['do-thing', '--space-id', 's1', '--limit', '5']
    )
    expect(input).toEqual({ spaceId: 's1', limit: 5 })
  })

  it('still binds positional arguments declared via action.args', async () => {
    const input = await runCommand(
      action({
        input: z.object({ name: z.string(), loud: z.boolean().optional() }),
        args: ['name']
      }),
      ['do-thing', 'world', '--loud']
    )
    expect(input).toEqual({ name: 'world', loud: true })
  })
})

describe('cli union options', () => {
  // optionSpec runs while the command table is built, so an unsupported type
  // takes down every command including --help. This is the regression guard
  // that needs no invocation at all.
  it('builds the command table for an action with a union input', async () => {
    const input = await runCommand(
      action({
        input: z.object({ cost: z.union([z.number(), z.array(z.number())]).optional() })
      }),
      ['do-thing']
    )
    expect(input).toEqual({})
  })

  it('round-trips both arms of a scalar-or-array union', async () => {
    const numeric = z.object({ cost: z.union([z.number(), z.array(z.number())]).optional() })
    expect(await runCommand(action({ input: numeric }), ['do-thing', '--cost', '3'])).toEqual({ cost: 3 })
    expect(await runCommand(action({ input: numeric }), ['do-thing', '--cost', '[1,2]'])).toEqual({ cost: [1, 2] })
  })

  it('keeps a non-JSON string arm intact instead of throwing on it', async () => {
    const input = await runCommand(
      action({
        input: z.object({ tag: z.union([z.string(), z.array(z.string())]).optional() })
      }),
      ['do-thing', '--tag', 'alpha']
    )
    expect(input).toEqual({ tag: 'alpha' })
  })

  it('does not coerce a union of string literals', async () => {
    const input = await runCommand(
      action({
        input: z.object({ mode: z.union([z.literal('1'), z.literal('2')]).optional() })
      }),
      ['do-thing', '--mode', '1']
    )
    expect(input).toEqual({ mode: '1' })
  })

  it('parses a union of non-string literals back off the string', async () => {
    const input = await runCommand(
      action({
        input: z.object({ level: z.union([z.literal(1), z.literal(2)]).optional() })
      }),
      ['do-thing', '--level', '2']
    )
    expect(input).toEqual({ level: 2 })
  })

  it('names the offending field when a type is unsupported', async () => {
    await expect(
      runCommand(
        action({
          input: z.object({ when: z.date() })
        }),
        ['do-thing']
      )
    ).rejects.toThrow('option "when": unsupported zod type date')
  })
})
