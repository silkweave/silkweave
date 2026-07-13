import { describe, expect, it, vi } from 'vitest'
import { createContext } from './context.js'
import { emitToolCall, type ToolCallEvent } from './telemetry.js'

const event = (): ToolCallEvent => ({
  action: 'users.get',
  tool: 'UsersGet',
  transport: 'mcp',
  durationMs: 1,
  ok: true,
  context: createContext()
})

describe('emitToolCall', () => {
  it('invokes the hook with the event', () => {
    const hook = vi.fn()
    emitToolCall(hook, event())
    expect(hook).toHaveBeenCalledTimes(1)
    expect(hook.mock.calls[0][0]).toMatchObject({ tool: 'UsersGet', ok: true })
  })

  it('is a no-op without a hook', () => {
    expect(() => { emitToolCall(undefined, event()) }).not.toThrow()
  })

  it('swallows and logs sync throws', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => { })
    expect(() => { emitToolCall(() => { throw new Error('down') }, event()) }).not.toThrow()
    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
  })

  it('swallows and logs async rejections', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => { })
    emitToolCall(async () => { throw new Error('down') }, event())
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
  })
})
