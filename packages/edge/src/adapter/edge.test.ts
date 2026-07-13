import { createContext, SilkweaveError, type Action } from '@silkweave/core'
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
    if (role !== 'reader' && role !== 'writer') { throw new SilkweaveError('invalid api key', 'invalid_key', 401) }
    return role === 'reader' ? all.filter((a) => a.tags?.includes('read')) : all
  }

  it('computes the tool list per request', async () => {
    const app = await startEdge({ filterActions })
    const reader = await (await app.handler(post(list, { 'x-role': 'reader' }))).json() as { result: { tools: { name: string }[] } }
    const writer = await (await app.handler(post(list, { 'x-role': 'writer' }))).json() as { result: { tools: { name: string }[] } }
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
    await app.handler(post({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'LeadsList', arguments: {} } }))
    expect(seen[0]).toEqual({ method: 'tools/list', toolName: undefined })
    expect(seen[1]).toEqual({ method: 'tools/call', toolName: 'LeadsList' })
  })

  it('surfaces a thrown SilkweaveError as its statusCode with a JSON-RPC error body', async () => {
    const app = await startEdge({ filterActions })
    const res = await app.handler(post(list, { 'x-role': 'intruder' }))
    expect(res.status).toBe(401)
    const body = await res.json() as { error: { message: string }; id: number }
    expect(body.error.message).toBe('invalid api key')
    expect(body.id).toBe(1)
  })

  it('runs without a filter exactly as before', async () => {
    const app = await startEdge()
    const res = await app.handler(post(list))
    const body = await res.json() as { result: { tools: { name: string }[] } }
    expect(body.result.tools).toHaveLength(2)
  })
})
