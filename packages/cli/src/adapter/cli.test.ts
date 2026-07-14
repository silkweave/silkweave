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
  const received = new Promise<object>((resolve) => { resolveInput = resolve })
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
    const input = await runCommand(action({
      input: z.object({ action_id: z.string(), dry_run: z.boolean().optional() })
    }), ['do-thing', '--action-id', 'abc', '--dry-run'])
    expect(input).toEqual({ action_id: 'abc', dry_run: true })
  })

  it('maps kebab-case flags back to camelCase input keys', async () => {
    const input = await runCommand(action({
      input: z.object({ spaceId: z.string(), limit: z.number().optional() })
    }), ['do-thing', '--space-id', 's1', '--limit', '5'])
    expect(input).toEqual({ spaceId: 's1', limit: 5 })
  })

  it('still binds positional arguments declared via action.args', async () => {
    const input = await runCommand(action({
      input: z.object({ name: z.string(), loud: z.boolean().optional() }),
      args: ['name']
    }), ['do-thing', 'world', '--loud'])
    expect(input).toEqual({ name: 'world', loud: true })
  })
})
