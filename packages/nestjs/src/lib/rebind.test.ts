import { describe, expect, it } from 'vitest'
import { invokeRebound, specialBinding, type Binding } from './rebind.js'
import { PARAMTYPE } from './reflect/params.js'

/** Invoke with a method that echoes its positional args, so we can assert the rebind. */
async function rebind(
  bindings: Binding[],
  input: Record<string, unknown>,
  opts: {
    request?: { headers?: Record<string, unknown>; ip?: unknown; hosts?: Record<string, unknown> }
    response?: unknown
    pipes?: boolean
  } = {}
): Promise<unknown[]> {
  const echo = (...args: unknown[]): unknown[] => args
  return (await invokeRebound(echo, {}, input, bindings, opts.request, opts.response, opts.pipes ?? false)) as unknown[]
}

describe('invokeRebound / resolveArg', () => {
  it('pulls a scalar value field straight from the input', async () => {
    const args = await rebind([{ kind: 'value', field: 'id', source: 'path' }], { id: 5 })
    expect(args[0]).toBe(5)
  })

  it('applies parameter-bound pipes only when enabled', async () => {
    const double = { transform: (value: unknown): number => (value as number) * 2 }
    const binding: Binding = { kind: 'value', field: 'n', source: 'query', pipes: [double] }
    expect((await rebind([binding], { n: 3 }, { pipes: true }))[0]).toBe(6)
    expect((await rebind([binding], { n: 3 }, { pipes: false }))[0]).toBe(3)
  })

  it('picks only the declared fields for a whole-DTO object binding, skipping undefined', async () => {
    const binding: Binding = { kind: 'object', source: 'body', fields: ['a', 'b'] }
    expect((await rebind([binding], { a: 1, b: 2, c: 3 }))[0]).toEqual({ a: 1, b: 2 })
    expect((await rebind([binding], { a: 1 }))[0]).toEqual({ a: 1 })
  })

  it('reconstructs a whole @Param() object from path fields', async () => {
    const args = await rebind([{ kind: 'params', fields: ['spaceId'] }], { spaceId: 'sp_1' })
    expect(args[0]).toEqual({ spaceId: 'sp_1' })
  })

  it('reads a specific header case-insensitively', async () => {
    const args = await rebind(
      [{ kind: 'headers', data: 'X-Api-Key' }],
      {},
      { request: { headers: { 'x-api-key': 'secret' } } }
    )
    expect(args[0]).toBe('secret')
  })

  it('returns all headers for a bare @Headers()', async () => {
    const headers = { 'x-api-key': 'secret', accept: 'json' }
    const args = await rebind([{ kind: 'headers' }], {}, { request: { headers } })
    expect(args[0]).toBe(headers)
  })

  it('resolves @Req to the request, falling back to a header-less stand-in when absent', async () => {
    const request = { headers: { a: '1' } }
    expect((await rebind([{ kind: 'request' }], {}, { request }))[0]).toBe(request)
    expect((await rebind([{ kind: 'request' }], {}))[0]).toEqual({ headers: {} })
  })

  it('resolves @Res to the response value (undefined over MCP)', async () => {
    const res = { setHeader: (): void => {} }
    expect((await rebind([{ kind: 'response' }], {}, { response: res }))[0]).toBe(res)
    expect((await rebind([{ kind: 'response' }], {}))[0]).toBeUndefined()
  })

  it('resolves @Ip and @HostParam from the request', async () => {
    expect((await rebind([{ kind: 'ip' }], {}, { request: { ip: '1.2.3.4' } }))[0]).toBe('1.2.3.4')
    expect((await rebind([{ kind: 'host', data: 'sub' }], {}, { request: { hosts: { sub: 'tenant' } } }))[0]).toBe(
      'tenant'
    )
  })

  it('resolves an unsupported slot (missing) to undefined', async () => {
    expect((await rebind([{ kind: 'missing' }], {}))[0]).toBeUndefined()
  })

  it('reconstructs multiple args in binding order', async () => {
    const args = await rebind(
      [
        { kind: 'value', field: 'id', source: 'path' },
        { kind: 'headers', data: 'x-api-key' },
        { kind: 'value', field: 'name', source: 'body' }
      ],
      { id: 7, name: 'ada' },
      { request: { headers: { 'x-api-key': 'k' } } }
    )
    expect(args).toEqual([7, 'k', 'ada'])
  })
})

describe('specialBinding', () => {
  it('maps Nest param decorators to runtime bindings', () => {
    expect(specialBinding(PARAMTYPE.REQUEST, undefined)).toEqual({ kind: 'request' })
    expect(specialBinding(PARAMTYPE.RESPONSE, undefined)).toEqual({ kind: 'response' })
    expect(specialBinding(PARAMTYPE.NEXT, undefined)).toEqual({ kind: 'response' })
    expect(specialBinding(PARAMTYPE.HEADERS, 'x-api-key')).toEqual({ kind: 'headers', data: 'x-api-key' })
    expect(specialBinding(PARAMTYPE.IP, undefined)).toEqual({ kind: 'ip' })
    expect(specialBinding(PARAMTYPE.HOST, 'sub')).toEqual({ kind: 'host', data: 'sub' })
  })

  it('maps unsupported-over-transport slots to missing', () => {
    for (const t of [PARAMTYPE.SESSION, PARAMTYPE.FILE, PARAMTYPE.FILES, PARAMTYPE.RAW_BODY]) {
      expect(specialBinding(t, undefined)).toEqual({ kind: 'missing' })
    }
  })

  it('returns null for input-sourced params (handled by the input bindings instead)', () => {
    expect(specialBinding(PARAMTYPE.BODY, undefined)).toBeNull()
    expect(specialBinding(PARAMTYPE.QUERY, undefined)).toBeNull()
    expect(specialBinding(PARAMTYPE.PARAM, undefined)).toBeNull()
  })
})
