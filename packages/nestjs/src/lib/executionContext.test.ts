import type { Type } from '@nestjs/common'
import { describe, expect, it } from 'vitest'
import { SilkweaveExecutionContext } from './executionContext.js'

class DummyController {}
const handler = function dummy(): void {}
const Ctrl = DummyController as Type<unknown>

describe('SilkweaveExecutionContext', () => {
  it('exposes the request/response/next through switchToHttp', () => {
    const req = { headers: { 'x-api-key': 'k' } }
    const res = { setHeader: (): void => {} }
    const next = (): void => {}
    const ctx = new SilkweaveExecutionContext([req, res, next], Ctrl, handler, 'http')

    const http = ctx.switchToHttp()
    expect(http.getRequest()).toBe(req)
    expect(http.getResponse()).toBe(res)
    expect(http.getNext()).toBe(next)
  })

  it('reports the transport via getType (http when a request is present)', () => {
    const ctx = new SilkweaveExecutionContext([{}, null], Ctrl, handler, 'http')
    expect(ctx.getType()).toBe('http')
  })

  it('reports rpc for transports with no HTTP request', () => {
    const ctx = new SilkweaveExecutionContext([undefined, null], Ctrl, handler, 'rpc')
    expect(ctx.getType()).toBe('rpc')
  })

  it('defaults getType to http when no contextType is given', () => {
    const ctx = new SilkweaveExecutionContext([{}, null], Ctrl, handler)
    expect(ctx.getType()).toBe('http')
  })

  it('returns the class and handler the guard reflects metadata off', () => {
    const ctx = new SilkweaveExecutionContext([{}, null], Ctrl, handler, 'http')
    expect(ctx.getClass()).toBe(Ctrl)
    expect(ctx.getHandler()).toBe(handler)
  })

  it('exposes the raw args array and indexed access', () => {
    const req = { id: 1 }
    const res = { id: 2 }
    const ctx = new SilkweaveExecutionContext([req, res], Ctrl, handler, 'http')
    expect(ctx.getArgs()).toEqual([req, res])
    expect(ctx.getArgByIndex(0)).toBe(req)
    expect(ctx.getArgByIndex(1)).toBe(res)
  })

  it('maps the rpc host to (data, context) = (args[0], args[1])', () => {
    const data = { a: 1 }
    const context = { b: 2 }
    const ctx = new SilkweaveExecutionContext([data, context], Ctrl, handler, 'rpc')
    const rpc = ctx.switchToRpc()
    expect(rpc.getData()).toBe(data)
    expect(rpc.getContext()).toBe(context)
  })

  it('stubs the ws host without throwing', () => {
    const client = { c: 1 }
    const ctx = new SilkweaveExecutionContext([client, {}], Ctrl, handler, 'ws')
    const ws = ctx.switchToWs()
    expect(ws.getClient()).toBe(client)
    expect(ws.getPattern()).toBe('')
  })
})
