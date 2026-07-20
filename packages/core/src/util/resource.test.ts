import { describe, expect, it } from 'vitest'
import z from 'zod/v4'
import { validateActionDisposition, type Action } from './action.js'
import {
  base64ToBytes,
  binary,
  binarySchemaMeta,
  bytesToBase64,
  deserializeResource,
  isActionResource,
  isBinarySchema,
  isResourceLike,
  isTextMimeType,
  resource,
  resourceBytes,
  resourceText,
  serializeResource,
  toActionResource
} from './resource.js'

const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

describe('resource()', () => {
  it('brands the value and keeps bytes as-is', () => {
    const res = resource(PNG_BYTES, { mimeType: 'image/png', name: 'shot.png', description: 'a screenshot' })
    expect(isActionResource(res)).toBe(true)
    expect(res.data).toBe(PNG_BYTES)
    expect(res.mimeType).toBe('image/png')
    expect(res.name).toBe('shot.png')
    expect(res.description).toBe('a screenshot')
  })

  it('converts an ArrayBuffer to Uint8Array', () => {
    const res = resource(PNG_BYTES.slice().buffer, { mimeType: 'image/png' })
    expect(res.data).toBeInstanceOf(Uint8Array)
    expect([...(res.data as Uint8Array)]).toEqual([...PNG_BYTES])
  })

  it('accepts string data for text media types', () => {
    const res = resource('# Title', { mimeType: 'text/markdown' })
    expect(res.data).toBe('# Title')
  })
})

describe('isResourceLike', () => {
  it('accepts resources, blobs, files, and byte holders', () => {
    expect(isResourceLike(resource('x', { mimeType: 'text/plain' }))).toBe(true)
    expect(isResourceLike(new Blob(['x']))).toBe(true)
    expect(isResourceLike(new File(['x'], 'x.txt'))).toBe(true)
    expect(isResourceLike(new Uint8Array(2))).toBe(true)
    expect(isResourceLike(new ArrayBuffer(2))).toBe(true)
  })

  it('rejects plain objects, strings, and null', () => {
    expect(isResourceLike({ data: 'x' })).toBe(false)
    expect(isResourceLike('x')).toBe(false)
    expect(isResourceLike(null)).toBe(false)
  })
})

describe('toActionResource', () => {
  it('passes an ActionResource through untouched', async () => {
    const res = resource(PNG_BYTES, { mimeType: 'image/png' })
    expect(await toActionResource(res)).toBe(res)
  })

  it('normalizes a File with its own name and type', async () => {
    const file = new File([PNG_BYTES], 'shot.png', { type: 'image/png' })
    const res = await toActionResource(file)
    expect(res?.mimeType).toBe('image/png')
    expect(res?.name).toBe('shot.png')
    expect([...resourceBytes(res!)]).toEqual([...PNG_BYTES])
  })

  it('falls back to schema defaults for a typeless Blob', async () => {
    const res = await toActionResource(new Blob([PNG_BYTES]), { mimeType: 'image/png', description: 'from schema' })
    expect(res?.mimeType).toBe('image/png')
    expect(res?.description).toBe('from schema')
  })

  it('wraps bare bytes with defaults, octet-stream last resort', async () => {
    expect((await toActionResource(PNG_BYTES, { mimeType: 'image/png' }))?.mimeType).toBe('image/png')
    expect((await toActionResource(PNG_BYTES))?.mimeType).toBe('application/octet-stream')
    expect((await toActionResource(PNG_BYTES.slice().buffer))?.data).toBeInstanceOf(Uint8Array)
  })

  it('returns undefined for non-resource values', async () => {
    expect(await toActionResource({ hello: 'world' })).toBeUndefined()
    expect(await toActionResource('text')).toBeUndefined()
    expect(await toActionResource(null)).toBeUndefined()
  })
})

describe('isTextMimeType', () => {
  it.each([
    ['text/plain', true],
    ['text/markdown; charset=utf-8', true],
    ['application/json', true],
    ['application/vnd.api+json', true],
    ['image/svg+xml', true],
    ['application/xml', true],
    ['application/javascript', true],
    ['image/png', false],
    ['application/pdf', false],
    ['audio/mpeg', false],
    ['application/octet-stream', false]
  ])('%s -> %s', (mime, expected) => {
    expect(isTextMimeType(mime)).toBe(expected)
  })
})

describe('base64 round-trip', () => {
  it('round-trips arbitrary bytes, including large payloads', () => {
    const bytes = new Uint8Array(70000).map((_, i) => i % 256)
    expect([...base64ToBytes(bytesToBase64(bytes))]).toEqual([...bytes])
  })
})

describe('serializeResource / deserializeResource', () => {
  it('serializes text media types as text', () => {
    const serialized = serializeResource(resource('{"a":1}', { mimeType: 'application/json', name: 'data.json' }))
    expect(serialized).toEqual({ kind: 'resource', mimeType: 'application/json', name: 'data.json', text: '{"a":1}' })
  })

  it('serializes binary media types as base64 and round-trips', () => {
    const serialized = serializeResource(resource(PNG_BYTES, { mimeType: 'image/png', description: 'img' }))
    expect(serialized.base64).toBeDefined()
    expect(serialized.text).toBeUndefined()
    const back = deserializeResource(serialized)
    expect([...resourceBytes(back)]).toEqual([...PNG_BYTES])
    expect(back.mimeType).toBe('image/png')
    expect(back.description).toBe('img')
  })

  it('decodes binary data under a text mime type to text', () => {
    const serialized = serializeResource(resource(new TextEncoder().encode('hello'), { mimeType: 'text/plain' }))
    expect(serialized.text).toBe('hello')
  })
})

describe('resourceText / resourceBytes', () => {
  it('converts both directions', () => {
    const fromText = resource('hej', { mimeType: 'text/plain' })
    expect([...resourceBytes(fromText)]).toEqual([...new TextEncoder().encode('hej')])
    const fromBytes = resource(new TextEncoder().encode('hej'), { mimeType: 'text/plain' })
    expect(resourceText(fromBytes)).toBe('hej')
  })
})

describe('binary()', () => {
  it('is a Zod schema over resource-like values with an empty shape', () => {
    const schema = binary({ mimeType: 'image/png' })
    expect(schema.shape).toEqual({})
    expect(schema.safeParse(resource(PNG_BYTES, { mimeType: 'image/png' })).success).toBe(true)
    expect(schema.safeParse(new Uint8Array(1)).success).toBe(true)
    expect(schema.safeParse({ plain: 'object' }).success).toBe(false)
  })

  it('is detectable and carries its metadata', () => {
    const schema = binary({ mimeType: 'application/pdf', description: 'report' })
    expect(isBinarySchema(schema)).toBe(true)
    expect(isBinarySchema(z.object({}))).toBe(false)
    expect(binarySchemaMeta(schema)).toEqual({ mimeType: 'application/pdf', description: 'report' })
    expect(binarySchemaMeta(z.object({}))).toEqual({})
    expect(binarySchemaMeta(undefined)).toEqual({})
  })
})

describe('validateActionDisposition with binary outputs', () => {
  const base = {
    name: 'shot',
    description: 'take a screenshot',
    input: z.object({}),
    run: async () => new Uint8Array(1)
  } as unknown as Action

  it('rejects structured over a binary output', () => {
    const action = { ...base, disposition: 'structured', output: binary() } as unknown as Action
    expect(() => validateActionDisposition(action)).toThrow(/binary\(\) output/)
  })

  it('rejects binary chunk schemas', () => {
    const action = { ...base, chunk: binary() } as unknown as Action
    expect(() => validateActionDisposition(action)).toThrow(/chunk schema/)
  })

  it('accepts a plain binary output with default disposition', () => {
    const action = { ...base, output: binary() } as unknown as Action
    expect(() => validateActionDisposition(action)).not.toThrow()
  })
})
