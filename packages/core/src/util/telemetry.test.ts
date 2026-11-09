import { describe, expect, it, vi } from 'vitest'
import { createContext } from './context.js'
import { SilkweaveError } from './error.js'
import {
  emitToolCall,
  faultForStatus,
  invalidArgumentsMeta,
  toolCallErrorMeta,
  type ToolCallEvent
} from './telemetry.js'

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
    expect(() => {
      emitToolCall(undefined, event())
    }).not.toThrow()
  })

  it('swallows and logs sync throws', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() => {
      emitToolCall(() => {
        throw new Error('down')
      }, event())
    }).not.toThrow()
    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
  })

  it('swallows and logs async rejections', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    emitToolCall(async () => {
      throw new Error('down')
    }, event())
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
  })
})

describe('toolCallErrorMeta', () => {
  it('uses a SilkweaveError code and statusCode', () => {
    expect(toolCallErrorMeta(new SilkweaveError('gone', 'not_found', 404))).toEqual({
      errorCode: 'not_found',
      errorMessage: 'gone',
      statusCode: 404,
      fault: 'client'
    })
  })

  it('defaults an unannotated SilkweaveError to a 500 server fault', () => {
    expect(toolCallErrorMeta(new SilkweaveError('x', 'internal'))).toMatchObject({ statusCode: 500, fault: 'server' })
  })

  it('reads getStatus() (NestJS HttpException shape)', () => {
    class NotFoundException extends Error {
      override name = 'NotFoundException'
      getStatus() {
        return 404
      }
    }
    expect(toolCallErrorMeta(new NotFoundException('missing'))).toEqual({
      errorCode: 'NotFoundException',
      errorMessage: 'missing',
      statusCode: 404,
      fault: 'client'
    })
  })

  it('reads a numeric statusCode/status property within 400-599', () => {
    expect(toolCallErrorMeta(Object.assign(new Error('a'), { statusCode: 401 }))).toMatchObject({
      statusCode: 401,
      fault: 'client'
    })
    expect(toolCallErrorMeta(Object.assign(new Error('b'), { status: 503 }))).toMatchObject({
      statusCode: 503,
      fault: 'server'
    })
    expect(toolCallErrorMeta(Object.assign(new Error('c'), { status: 200 }))).toMatchObject({
      statusCode: 500,
      fault: 'server'
    })
    expect(toolCallErrorMeta(Object.assign(new Error('d'), { status: 'nope' }))).toMatchObject({ statusCode: 500 })
  })

  it('grades plain errors and non-errors as 500 server faults', () => {
    expect(toolCallErrorMeta(new TypeError('boom'))).toEqual({
      errorCode: 'TypeError',
      errorMessage: 'boom',
      statusCode: 500,
      fault: 'server'
    })
    expect(toolCallErrorMeta('str')).toEqual({ errorCode: 'unknown', statusCode: 500, fault: 'server' })
  })
})

describe('invalidArgumentsMeta / faultForStatus', () => {
  it('is a stable 400 client fault', () => {
    expect(invalidArgumentsMeta('bad')).toEqual({
      errorCode: 'INVALID_ARGUMENTS',
      errorMessage: 'bad',
      statusCode: 400,
      fault: 'client'
    })
  })

  it('splits at 500', () => {
    expect(faultForStatus(499)).toBe('client')
    expect(faultForStatus(500)).toBe('server')
  })
})
