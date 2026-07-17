import { createContext, SilkweaveError, type Action, type ToolCallEvent } from '@silkweave/core'
import express from 'express'
import { type Server } from 'http'
import { type AddressInfo } from 'net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { z } from 'zod/v4'
import { type FilterRequest } from './filter.js'
import { mcpTransport } from './transport.js'

function testAction(name: string, tags: string[]): Action {
  return {
    name,
    description: `${name} test action`,
    input: z.object({}),
    tags,
    run: async () => ({ ok: true })
  } as Action
}

const actions = [testAction('leads.list', ['read']), testAction('leads.delete', ['write'])]
const seen: FilterRequest[] = []

let server: Server
let port: number

beforeAll(async () => {
  const app = express()
  const transport = mcpTransport({ name: 'test', description: 'test', version: '0.0.0' }, createContext({ adapter: 'http' }), actions, {
    filterActions: (all, request) => {
      seen.push(request)
      const role = request.headers['x-role']
      if (role === 'boom') { throw new Error('db down') }
      if (role !== 'reader' && role !== 'writer') { throw new SilkweaveError('invalid api key', 'invalid_key', 401) }
      return role === 'reader' ? all.filter((a) => a.tags?.includes('read')) : all
    }
  })
  app.post('/mcp', express.json(), transport.post)
  server = app.listen(0)
  port = (server.address() as AddressInfo).port
})

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())))

async function rpc(body: object, headers: Record<string, string> = {}) {
  return fetch(`http://127.0.0.1:${port}/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...headers },
    body: JSON.stringify(body)
  })
}

/** Parse the first JSON-RPC message out of a per-request SSE response. */
async function sseData(res: Response): Promise<{ result?: { tools?: { name: string }[] } }> {
  const text = await res.text()
  const line = text.split('\n').find((l) => l.startsWith('data: '))
  return line ? JSON.parse(line.slice(6)) : {}
}

const list = { jsonrpc: '2.0', id: 1, method: 'tools/list' }

describe('mcpTransport filterActions', () => {
  it('computes the tool list per request from the same server', async () => {
    const reader = await sseData(await rpc(list, { 'x-role': 'reader' }))
    const writer = await sseData(await rpc(list, { 'x-role': 'writer' }))
    expect(reader.result!.tools!.map((t) => t.name)).toEqual(['LeadsList'])
    expect(writer.result!.tools!.map((t) => t.name).sort()).toEqual(['LeadsDelete', 'LeadsList'])
  })

  it('passes the JSON-RPC method and toolName to the filter', async () => {
    seen.length = 0
    await rpc(list, { 'x-role': 'reader' })
    await rpc({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'LeadsList', arguments: {} } }, { 'x-role': 'reader' })
    expect(seen[0]).toMatchObject({ method: 'tools/list', url: '/mcp' })
    expect(seen[0].toolName).toBeUndefined()
    expect(seen[1]).toMatchObject({ method: 'tools/call', toolName: 'LeadsList' })
  })

  it('surfaces a thrown SilkweaveError as its statusCode, never an empty tool list', async () => {
    const res = await rpc(list, { 'x-role': 'intruder' })
    expect(res.status).toBe(401)
    const body = await res.json() as { error: { message: string }; id: number }
    expect(body.error.message).toBe('invalid api key')
    expect(body.id).toBe(1)
  })

  it('maps any other filter throw to a 500 internal error', async () => {
    const res = await rpc(list, { 'x-role': 'boom' })
    expect(res.status).toBe(500)
    const body = await res.json() as { error: { message: string } }
    expect(body.error.message).toBe('Internal server error')
  })

  it('rejects a JSON-RPC batch (would otherwise bypass the per-message filter)', async () => {
    // A batch reflects only the first message to the filter but the transport
    // would execute every entry - so a batch is rejected outright (400).
    const batch = [
      { jsonrpc: '2.0', id: 1, method: 'tools/list' },
      { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'LeadsDelete', arguments: {} } }
    ]
    const res = await rpc(batch, { 'x-role': 'reader' })
    expect(res.status).toBe(400)
    const body = await res.json() as { error: { message: string } }
    expect(body.error.message).toMatch(/batch/i)
  })
})

describe('mcpTransport onToolCall telemetry', () => {
  let hookServer: Server
  let hookPort: number
  const events: ToolCallEvent[] = []
  const strict = {
    name: 'leads.get',
    description: 'Get a lead',
    input: z.object({ id: z.string() }),
    run: async ({ id }: { id: string }) => ({ id })
  } as Action

  beforeAll(async () => {
    const app = express()
    const transport = mcpTransport({ name: 'test', description: 'test', version: '0.0.0' }, createContext({ adapter: 'http' }), [strict], {
      onToolCall: (event) => { events.push(event) }
    })
    app.post('/mcp', express.json(), transport.post)
    hookServer = app.listen(0)
    hookPort = (hookServer.address() as AddressInfo).port
  })

  afterAll(() => new Promise<void>((resolve) => hookServer.close(() => resolve())))

  async function callLeadsGet(args: unknown) {
    return fetch(`http://127.0.0.1:${hookPort}/mcp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'LeadsGet', arguments: args } })
    })
  }

  it('emits exactly one success event carrying the parsed args', async () => {
    events.length = 0
    const res = await callLeadsGet({ id: 'l1' })
    expect(res.status).toBe(200)
    await res.text()
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ action: 'leads.get', tool: 'LeadsGet', ok: true, args: { id: 'l1' } })
  })

  it('emits an INVALID_ARGUMENTS event while the SDK still produces its native rejection', async () => {
    events.length = 0
    const res = await callLeadsGet({ id: 42 })
    // Emit-only: the wire response is still the SDK's own rejection (an
    // isError tool result on SDK >= 1.29), delivered as this request's SSE.
    const text = await res.text()
    expect(text).toContain('Input validation error')
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      action: 'leads.get',
      tool: 'LeadsGet',
      transport: 'mcp',
      durationMs: 0,
      ok: false,
      errorCode: 'INVALID_ARGUMENTS',
      args: { id: 42 }
    })
  })
})
