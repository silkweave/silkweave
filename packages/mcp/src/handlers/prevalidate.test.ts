import { createContext, type Action, type ToolCallEvent } from '@silkweave/core'
import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod/v4'
import { emitInvalidArguments } from './prevalidate.js'

function action(overrides: Partial<Action> = {}): Action {
  return {
    name: 'hello.world',
    description: 'Say hello',
    input: z.object({ name: z.string() }),
    run: async ({ name }: { name: string }) => ({ greeting: `Hello ${name}` }),
    ...overrides
  } as Action
}

function collect() {
  const events: ToolCallEvent[] = []
  return { events, onToolCall: (event: ToolCallEvent) => { events.push(event) } }
}

function toolCall(name: string, args: unknown): object {
  return { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }
}

/** emitToolCall defers the hook through a resolved promise - flush it. */
const flush = () => new Promise((resolve) => { setTimeout(resolve, 0) })

describe('emitInvalidArguments', () => {
  it('emits an INVALID_ARGUMENTS event with the raw offered input', async () => {
    const { events, onToolCall } = collect()
    const context = createContext()
    const raw = { name: 42, extra: 'kept-verbatim' }
    await emitInvalidArguments(toolCall('HelloWorld', raw), [action()], context, onToolCall)
    await flush()
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      action: 'hello.world',
      tool: 'HelloWorld',
      transport: 'mcp',
      durationMs: 0,
      ok: false,
      errorCode: 'INVALID_ARGUMENTS',
      args: raw,
      context
    })
    expect(events[0].errorMessage).toContain('HelloWorld')
    expect(events[0].errorMessage).toContain('name')
  })

  it('emits when arguments are missing entirely (parses the verbatim undefined, like the SDK)', async () => {
    const { events, onToolCall } = collect()
    await emitInvalidArguments(
      { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'HelloWorld' } },
      [action()], createContext(), onToolCall
    )
    await flush()
    expect(events).toHaveLength(1)
    expect(events[0].args).toBeUndefined()
  })

  it('does not emit when arguments are valid', async () => {
    const { events, onToolCall } = collect()
    await emitInvalidArguments(toolCall('HelloWorld', { name: 'Ada' }), [action()], createContext(), onToolCall)
    await flush()
    expect(events).toHaveLength(0)
  })

  it('supports async refinements (safeParseAsync, matching the SDK)', async () => {
    const { events, onToolCall } = collect()
    const asyncAction = action({
      input: z.object({ name: z.string() }).refine(async ({ name }) => name !== 'nope', 'name rejected')
    })
    await emitInvalidArguments(toolCall('HelloWorld', { name: 'nope' }), [asyncAction], createContext(), onToolCall)
    await flush()
    expect(events).toHaveLength(1)
    expect(events[0].errorMessage).toContain('name rejected')
  })

  it('skips non-tools/call methods and unknown tools', async () => {
    const { events, onToolCall } = collect()
    const context = createContext()
    await emitInvalidArguments({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, [action()], context, onToolCall)
    await emitInvalidArguments(toolCall('NoSuchTool', { name: 42 }), [action()], context, onToolCall)
    await emitInvalidArguments(undefined, [action()], context, onToolCall)
    await flush()
    expect(events).toHaveLength(0)
  })

  it('is a no-op without a hook', async () => {
    const throwing = action({
      input: new Proxy({}, { get: () => { throw new Error('should not be touched') } }) as unknown as Action['input']
    })
    await expect(emitInvalidArguments(toolCall('HelloWorld', {}), [throwing], createContext(), undefined)).resolves.toBeUndefined()
  })

  it('swallows unexpected internal errors - telemetry can never fail the call path', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => { })
    const { events, onToolCall } = collect()
    const broken = action({
      input: { safeParseAsync: () => { throw new Error('boom') } } as unknown as Action['input']
    })
    await expect(emitInvalidArguments(toolCall('HelloWorld', {}), [broken], createContext(), onToolCall)).resolves.toBeUndefined()
    expect(events).toHaveLength(0)
    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
  })
})
