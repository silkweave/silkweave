import { SilkweaveError } from '@silkweave/core'
import { describe, expect, it, vi } from 'vitest'
import { errorToolResult, handleToolError, jsonToolResult, parseResourceMessage, smartToolResult } from './result.js'

interface TextBlock { type: 'text'; text: string }
interface ResourceBlock { type: 'resource'; resource: { uri: string; mimeType: string; blob: string } }

describe('smartToolResult', () => {
  it('returns a single text block for a small string payload', () => {
    const result = smartToolResult('hello')
    expect(result.content).toEqual([{ type: 'text', text: 'hello' }])
  })

  it('JSON-stringifies a small object payload into one text block', () => {
    const result = smartToolResult({ a: 1, b: 'two' })
    expect(result.content).toEqual([{ type: 'text', text: '{"a":1,"b":"two"}' }])
  })

  it('splits a large string into a summary + base64 embedded text resource', () => {
    const big = 'x'.repeat(5000)
    const result = smartToolResult(big)
    expect(result.content).toHaveLength(2)
    const [summary, resource] = result.content as [TextBlock, ResourceBlock]
    expect(summary.text).toBe(`Received resource ${resource.resource.uri} with 5000 bytes`)
    expect(resource.resource.uri).toMatch(/^mcp:\/\/toolResult\/.+\.txt$/)
    expect(resource.resource.mimeType).toBe('text/plain')
    expect(Buffer.from(resource.resource.blob, 'base64').toString('utf-8')).toBe(big)
  })

  it('uses a json uri + mimeType for a large object payload', () => {
    const big = { data: 'x'.repeat(5000) }
    const result = smartToolResult(big)
    const [, resource] = result.content as [TextBlock, ResourceBlock]
    expect(resource.resource.uri).toMatch(/\.json$/)
    expect(resource.resource.mimeType).toBe('application/json')
    expect(Buffer.from(resource.resource.blob, 'base64').toString('utf-8')).toBe(JSON.stringify(big))
  })

  it('round-trips through parseResourceMessage', () => {
    const big = 'y'.repeat(5000)
    const [, resource] = smartToolResult(big).content as [TextBlock, ResourceBlock]
    expect(parseResourceMessage(resource)).toBe(big)
  })
})

describe('jsonToolResult', () => {
  it('stringifies the payload and omits isError by default', () => {
    const result = jsonToolResult({ ok: true })
    expect(result.content).toEqual([{ type: 'text', text: '{"ok":true}' }])
    expect(result.isError).toBeUndefined()
  })

  it('sets isError when asked', () => {
    expect(jsonToolResult({ ok: false }, true).isError).toBe(true)
  })
})

describe('errorToolResult', () => {
  it('serializes a SilkweaveError as a failed result with code/name/message', () => {
    const result = errorToolResult(new SilkweaveError('nope', 'forbidden', 403))
    expect(result.isError).toBe(true)
    const [block] = result.content as [TextBlock]
    expect(JSON.parse(block.text)).toEqual({ success: false, code: 'forbidden', name: 'SilkweaveError', message: 'nope' })
  })
})

describe('handleToolError', () => {
  it('maps a SilkweaveError to a failed result carrying its code', () => {
    const result = handleToolError(new SilkweaveError('denied', 'forbidden', 403))
    expect(result.isError).toBe(true)
    const [block] = result.content as [TextBlock]
    expect(JSON.parse(block.text)).toEqual({ success: false, name: 'SilkweaveError', message: 'denied', code: 'forbidden' })
  })

  it('maps a plain Error to a failed result without leaking a code, logging server-side only', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const result = handleToolError(new Error('boom'))
    const [block] = result.content as [TextBlock]
    expect(JSON.parse(block.text)).toEqual({ success: false, name: 'Error', message: 'boom' })
    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
  })

  it('maps an unknown thrown value to a generic message', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const result = handleToolError('just a string')
    const [block] = result.content as [TextBlock]
    expect(JSON.parse(block.text)).toEqual({ success: false, name: 'Unknown error', message: 'An unknown error occurred' })
    spy.mockRestore()
  })
})

describe('parseResourceMessage', () => {
  it('decodes a base64 blob resource', () => {
    const blob = Buffer.from('hello world').toString('base64')
    expect(parseResourceMessage({ type: 'resource', resource: { uri: 'mcp://x', mimeType: 'text/plain', blob } })).toBe('hello world')
  })

  it('returns the text of a non-blob resource', () => {
    expect(parseResourceMessage({ type: 'resource', resource: { uri: 'mcp://x', mimeType: 'text/plain', text: 'plain' } })).toBe('plain')
  })
})
