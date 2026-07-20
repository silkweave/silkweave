import { resource, SilkweaveError } from '@silkweave/core'
import { describe, expect, it, vi } from 'vitest'
import { errorToolResult, handleToolError, jsonToolResult, parseResourceMessage, resourceToolResult, smartToolResult } from './result.js'

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
    const [summary, resourceBlock] = result.content as [TextBlock, ResourceBlock]
    expect(summary.text).toBe(`Received resource ${resourceBlock.resource.uri} with 5000 bytes`)
    expect(resourceBlock.resource.uri).toMatch(/^mcp:\/\/toolResult\/.+\.txt$/)
    expect(resourceBlock.resource.mimeType).toBe('text/plain')
    expect(Buffer.from(resourceBlock.resource.blob, 'base64').toString('utf-8')).toBe(big)
  })

  it('uses a json uri + mimeType for a large object payload', () => {
    const big = { data: 'x'.repeat(5000) }
    const result = smartToolResult(big)
    const [, resourceBlock] = result.content as [TextBlock, ResourceBlock]
    expect(resourceBlock.resource.uri).toMatch(/\.json$/)
    expect(resourceBlock.resource.mimeType).toBe('application/json')
    expect(Buffer.from(resourceBlock.resource.blob, 'base64').toString('utf-8')).toBe(JSON.stringify(big))
  })

  it('round-trips through parseResourceMessage', () => {
    const big = 'y'.repeat(5000)
    const [, resourceBlock] = smartToolResult(big).content as [TextBlock, ResourceBlock]
    expect(parseResourceMessage(resourceBlock)).toBe(big)
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

describe('resourceToolResult', () => {
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47])

  it('maps raster images to an image content block', () => {
    const result = resourceToolResult(resource(png, { mimeType: 'image/png' }))
    expect(result.content).toEqual([
      { type: 'image', data: Buffer.from(png).toString('base64'), mimeType: 'image/png' }
    ])
  })

  it('prepends the description as a text block', () => {
    const result = resourceToolResult(resource(png, { mimeType: 'image/png', description: 'Screenshot of the dashboard' }))
    expect(result.content).toHaveLength(2)
    expect(result.content[0]).toEqual({ type: 'text', text: 'Screenshot of the dashboard' })
    expect(result.content[1]).toMatchObject({ type: 'image' })
  })

  it('maps audio media types to an audio content block', () => {
    const result = resourceToolResult(resource(new Uint8Array([1, 2]), { mimeType: 'audio/mpeg' }))
    expect(result.content[0]).toMatchObject({ type: 'audio', mimeType: 'audio/mpeg' })
  })

  it('maps text-based media types to an embedded resource with text', () => {
    const result = resourceToolResult(resource('{"a":1}', { mimeType: 'application/json', name: 'data.json' }))
    const [block] = result.content as [{ type: string; resource: { uri: string; mimeType: string; text?: string; blob?: string } }]
    expect(block.type).toBe('resource')
    expect(block.resource.text).toBe('{"a":1}')
    expect(block.resource.blob).toBeUndefined()
    expect(block.resource.uri).toMatch(/^mcp:\/\/toolResult\/.+\/data\.json$/)
  })

  it('maps SVG to a text resource, not an image block', () => {
    const result = resourceToolResult(resource('<svg/>', { mimeType: 'image/svg+xml' }))
    expect(result.content[0]).toMatchObject({ type: 'resource' })
  })

  it('maps other binary media types to an embedded resource with a base64 blob', () => {
    const result = resourceToolResult(resource(png, { mimeType: 'application/pdf' }))
    const [block] = result.content as unknown as [{ type: string; resource: { blob?: string; mimeType: string } }]
    expect(block.type).toBe('resource')
    expect(block.resource.mimeType).toBe('application/pdf')
    expect(Buffer.from(block.resource.blob!, 'base64')).toEqual(Buffer.from(png))
  })

  it('normalizes mime parameters when classifying but preserves the declared type', () => {
    const result = resourceToolResult(resource(png, { mimeType: 'IMAGE/PNG; foo=bar' }))
    expect(result.content[0]).toMatchObject({ type: 'image', mimeType: 'image/png' })
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
