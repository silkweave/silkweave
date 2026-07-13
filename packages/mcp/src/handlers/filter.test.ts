import { SilkweaveError } from '@silkweave/core'
import { describe, expect, it, vi } from 'vitest'
import { filterErrorResponse, rpcInfo } from './filter.js'

describe('rpcInfo', () => {
  it('extracts the JSON-RPC method', () => {
    expect(rpcInfo({ jsonrpc: '2.0', id: 1, method: 'tools/list' })).toEqual({ method: 'tools/list' })
    expect(rpcInfo({ jsonrpc: '2.0', method: 'notifications/initialized' })).toEqual({ method: 'notifications/initialized' })
  })

  it('extracts toolName for tools/call only', () => {
    expect(rpcInfo({ method: 'tools/call', params: { name: 'UsersGet', arguments: {} } }))
      .toEqual({ method: 'tools/call', toolName: 'UsersGet' })
    expect(rpcInfo({ method: 'tools/list', params: { name: 'UsersGet' } })).toEqual({ method: 'tools/list' })
  })

  it('uses the first request of a legacy batch', () => {
    expect(rpcInfo([{ method: 'initialize' }, { method: 'tools/list' }])).toEqual({ method: 'initialize' })
  })

  it('returns an empty method for unrecognizable bodies', () => {
    expect(rpcInfo(undefined)).toEqual({ method: '' })
    expect(rpcInfo('nonsense')).toEqual({ method: '' })
    expect(rpcInfo({ jsonrpc: '2.0' })).toEqual({ method: '' })
  })
})

describe('filterErrorResponse', () => {
  it('maps a SilkweaveError to its statusCode with a JSON-RPC error body', () => {
    const { status, body } = filterErrorResponse(new SilkweaveError('invalid api key', 'invalid_key', 401), { id: 7, method: 'tools/list' })
    expect(status).toBe(401)
    expect(body).toEqual({ jsonrpc: '2.0', error: { code: -32_000, message: 'invalid api key' }, id: 7 })
  })

  it('maps any other throw to a 500 internal error', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => { })
    const { status, body } = filterErrorResponse(new Error('db down'), undefined)
    expect(status).toBe(500)
    expect(body).toMatchObject({ error: { code: -32_603, message: 'Internal server error' }, id: null })
    spy.mockRestore()
  })
})
