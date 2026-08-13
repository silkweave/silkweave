import { createContext, SilkweaveError, type Action, type ToolCallEvent } from '@silkweave/core'
import { describe, expect, it } from 'vitest'
import { z } from 'zod/v4'
import { edge, type EdgeAdapterOptions } from './edge.js'

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

/** Build a started edge adapter (JSON responses for easy assertions). */
async function startEdge(options: EdgeAdapterOptions = {}) {
  const app = edge({ enableJsonResponse: true, ...options })
  const generated = app.adapter({ name: 'test', description: 'test', version: '0.0.0' }, createContext())
  await generated.start(actions)
  return app
}

function post(body: object, headers: Record<string, string> = {}) {
  return new Request('http://localhost/mcp', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...headers },
    body: JSON.stringify(body)
  })
}

const list = { jsonrpc: '2.0', id: 1, method: 'tools/list' }

describe('edge filterActions', () => {
  const filterActions: EdgeAdapterOptions['filterActions'] = (all, request) => {
    const role = request.headers['x-role']
    if (role !== 'reader' && role !== 'writer') {
      throw new SilkweaveError('invalid api key', 'invalid_key', 401)
    }
    return role === 'reader' ? all.filter((a) => a.tags?.includes('read')) : all
  }

  it('computes the tool list per request', async () => {
    const app = await startEdge({ filterActions })
    const reader = (await (await app.handler(post(list, { 'x-role': 'reader' }))).json()) as {
      result: { tools: { name: string }[] }
    }
    const writer = (await (await app.handler(post(list, { 'x-role': 'writer' }))).json()) as {
      result: { tools: { name: string }[] }
    }
    expect(reader.result.tools.map((t) => t.name)).toEqual(['LeadsList'])
    expect(writer.result.tools.map((t) => t.name).sort()).toEqual(['LeadsDelete', 'LeadsList'])
  })

  it('passes the JSON-RPC method and toolName to the filter', async () => {
    const seen: { method: string; toolName?: string }[] = []
    const app = await startEdge({
      filterActions: (all, request) => {
        seen.push({ method: request.method, toolName: request.toolName })
        return all
      }
    })
    await app.handler(post(list))
    await app.handler(
      post({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'LeadsList', arguments: {} } })
    )
    expect(seen[0]).toEqual({ method: 'tools/list', toolName: undefined })
    expect(seen[1]).toEqual({ method: 'tools/call', toolName: 'LeadsList' })
  })

  it('surfaces a thrown SilkweaveError as its statusCode with a JSON-RPC error body', async () => {
    const app = await startEdge({ filterActions })
    const res = await app.handler(post(list, { 'x-role': 'intruder' }))
    expect(res.status).toBe(401)
    const body = (await res.json()) as { error: { message: string }; id: number }
    expect(body.error.message).toBe('invalid api key')
    expect(body.id).toBe(1)
  })

  it('runs without a filter exactly as before', async () => {
    const app = await startEdge()
    const res = await app.handler(post(list))
    const body = (await res.json()) as { result: { tools: { name: string }[] } }
    expect(body.result.tools).toHaveLength(2)
  })
})

describe('edge onToolCall telemetry', () => {
  const strict: Action = {
    name: 'leads.get',
    description: 'Get a lead',
    input: z.object({ id: z.string() }),
    run: async ({ id }: { id: string }) => ({ id })
  } as Action

  async function startWithHook() {
    const events: ToolCallEvent[] = []
    const app = edge({
      enableJsonResponse: true,
      onToolCall: (event) => {
        events.push(event)
      }
    })
    const generated = app.adapter({ name: 'test', description: 'test', version: '0.0.0' }, createContext())
    await generated.start([strict])
    return { app, events }
  }

  const call = (args: unknown) =>
    post({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'LeadsGet', arguments: args } })

  it('emits exactly one success event carrying the parsed args', async () => {
    const { app, events } = await startWithHook()
    const res = await app.handler(call({ id: 'l1' }))
    expect(res.status).toBe(200)
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ action: 'leads.get', tool: 'LeadsGet', ok: true, args: { id: 'l1' } })
  })

  it('emits an INVALID_ARGUMENTS event while the SDK still produces its native rejection', async () => {
    const { app, events } = await startWithHook()
    const raw = { id: 42 }
    const res = await app.handler(call(raw))
    // Emit-only: the wire response is the SDK's own native rejection - an
    // isError tool result carrying the InvalidParams message (SDK >= 1.29).
    expect(res.status).toBe(200)
    const body = (await res.json()) as { result: { isError: boolean; content: { text: string }[] } }
    expect(body.result.isError).toBe(true)
    expect(body.result.content[0].text).toContain('Input validation error')
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      action: 'leads.get',
      tool: 'LeadsGet',
      transport: 'mcp',
      durationMs: 0,
      ok: false,
      errorCode: 'INVALID_ARGUMENTS',
      args: raw
    })
  })
})
