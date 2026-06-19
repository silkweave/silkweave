import { describe, expect, it } from 'vitest'
import type { Binding } from './rebind.js'
import { populateRequestSlots, requestSlotFields } from './requestSlots.js'

type ReqSlots = Record<'params' | 'query' | 'body', Record<string, unknown>>

describe('requestSlotFields', () => {
  it('routes each input field to the request slot its source maps to', () => {
    const bindings: Binding[] = [
      { kind: 'value', field: 'id', source: 'path' },
      { kind: 'value', field: 'limit', source: 'query' },
      { kind: 'value', field: 'name', source: 'body' },
      { kind: 'object', source: 'query', fields: ['offset', 'sort'] },
      { kind: 'object', source: 'body', fields: ['title', 'description'] },
      { kind: 'params', fields: ['spaceId'] }
    ]
    expect(requestSlotFields(bindings)).toEqual({
      params: ['id', 'spaceId'],
      query: ['limit', 'offset', 'sort'],
      body: ['name', 'title', 'description']
    })
  })

  it('ignores non-input bindings (request/headers/response/...)', () => {
    const bindings: Binding[] = [
      { kind: 'headers', data: 'x-api-key' },
      { kind: 'request' },
      { kind: 'response' },
      { kind: 'ip' },
      { kind: 'missing' }
    ]
    expect(requestSlotFields(bindings)).toEqual({ params: [], query: [], body: [] })
  })
})

describe('populateRequestSlots', () => {
  const slots = { params: ['id'], query: ['limit'], body: ['sessionId'] }

  it('fills params/query/body from input, stringifying path + query but keeping parsed body values', () => {
    const req: ReqSlots = { params: {}, query: {}, body: {} }
    populateRequestSlots(req, slots, { id: 42, limit: 10, sessionId: 'abc', extra: 'x' })
    expect(req.params).toEqual({ id: '42' })
    expect(req.query).toEqual({ limit: '10' })
    expect(req.body).toEqual({ sessionId: 'abc' })
  })

  it('only fills absent keys, never clobbering a real REST/tRPC request', () => {
    const req: ReqSlots = { params: { id: 'real' }, query: { limit: '5' }, body: { sessionId: 'real-session' } }
    populateRequestSlots(req, slots, { id: 'fromInput', limit: 99, sessionId: 'fromInput' })
    expect(req.params).toEqual({ id: 'real' })
    expect(req.query).toEqual({ limit: '5' })
    expect(req.body).toEqual({ sessionId: 'real-session' })
  })

  it('creates only the slots that have fields, leaving the rest untouched', () => {
    const req: Record<string, unknown> = {}
    populateRequestSlots(req, { params: ['id'], query: [], body: ['name'] }, { id: 7, name: 'foo' })
    expect(req.params).toEqual({ id: '7' })
    expect(req.body).toEqual({ name: 'foo' })
    expect('query' in req).toBe(false)
  })

  it('skips fields missing from the input', () => {
    const req: ReqSlots = { params: {}, query: {}, body: {} }
    populateRequestSlots(req, { params: ['missing'], query: [], body: [] }, {})
    expect(req.params).toEqual({})
  })

  it('is a no-op (no throw) when there is no request object', () => {
    expect(() => populateRequestSlots(undefined, slots, { id: 1 })).not.toThrow()
    expect(() => populateRequestSlots(null, slots, { id: 1 })).not.toThrow()
  })

  // The OpenWA acceptance scenario in miniature: a per-key session-scoping guard
  // reads the requested session id off the reconstructed request. Before the
  // fidelity fix a `@Body('sessionId')` field never reached `req.body` over MCP,
  // so the guard under-scoped. Now it decides identically to REST.
  it('makes a @Body-sourced scope id readable at req.body over MCP', () => {
    const req: ReqSlots = { params: {}, query: {}, body: {} }
    populateRequestSlots(req, { params: [], query: [], body: ['sessionId'] }, { sessionId: 'session-b', text: 'hi' })
    expect(req.body.sessionId).toBe('session-b')
  })
})
