import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import { createContext, type Action, type SilkweaveContext } from '@silkweave/core'
import { beforeAll, describe, expect, it } from 'vitest'
import { z } from 'zod/v4'
import { edge } from './edge.js'

// Request-lifecycle edges of the edge adapter, driven by the real MCP SDK v2
// client on protocol 2026-07-28. Edge shares ONE boot-time MCP handler and
// finds each request's filtered actions + context in a WeakMap keyed by the
// Request, so overlapping requests are exactly where cross-talk would surface.

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

type Extra = { mcpReq: { signal: AbortSignal } }

let observeAbort: (reason: string) => void = () => undefined
let started: () => void = () => undefined

const actions = [
  {
    name: 'leads.list',
    description: 'List leads, echoing the caller after a delay',
    tags: ['read'],
    input: z.object({ delayMs: z.number().default(0) }),
    run: async ({ delayMs }: { delayMs: number }, context: SilkweaveContext) => {
      await sleep(delayMs)
      const request = context.get('request') as { headers: Record<string, string> }
      return { caller: request.headers['x-caller'] }
    }
  },
  {
    name: 'leads.delete',
    description: 'Delete a lead (writers only)',
    tags: ['write'],
    input: z.object({}),
    run: async () => ({ deleted: true })
  },
  {
    name: 'slow.job',
    description: 'Wait until the request is aborted (or 5s pass)',
    tags: ['read'],
    input: z.object({}),
    run: async (_input: object, context: SilkweaveContext) => {
      const { signal } = (context.get('extra') as Extra).mcpReq
      started()
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, 5000)
        signal.addEventListener('abort', () => {
          clearTimeout(timer)
          observeAbort('aborted')
          resolve()
        })
      })
      return { done: true }
    }
  }
] as unknown as Action[]

const url = new URL('http://localhost/mcp')
let app: ReturnType<typeof edge>

beforeAll(async () => {
  app = edge({
    filterActions: async (all, request) => {
      await sleep(Math.random() * 20)
      return request.headers['x-role'] === 'writer' ? all : all.filter((action) => action.tags?.includes('read'))
    }
  })
  await app.adapter({ name: 'lifecycle', description: 'lifecycle', version: '0.0.0' }, createContext()).start(actions)
})

async function connect(headers: Record<string, string>) {
  const client = new Client(
    { name: 'lifecycle-client', version: '0.0.0' },
    { versionNegotiation: { mode: { pin: '2026-07-28' } } }
  )
  await client.connect(
    new StreamableHTTPClientTransport(url, {
      requestInit: { headers },
      fetch: (input, init) => app.handler(new Request(input, init))
    })
  )
  return client
}

function payload(result: { content?: unknown }) {
  const [block] = result.content as { type: string; text: string }[]
  return JSON.parse(block.text) as Record<string, unknown>
}

describe('edge: concurrent requests with different tool filters', () => {
  it('computes each tool list from its own request, never a neighbour', async () => {
    const roles = Array.from({ length: 16 }, (_, index) => (index % 2 === 0 ? 'reader' : 'writer'))
    const clients = await Promise.all(roles.map((role) => connect({ 'x-role': role })))
    const lists = await Promise.all(clients.map((client) => client.listTools()))
    lists.forEach(({ tools }, index) => {
      expect(tools.map((tool) => tool.name).sort()).toEqual(
        roles[index] === 'writer' ? ['LeadsDelete', 'LeadsList', 'SlowJob'] : ['LeadsList', 'SlowJob']
      )
    })
    await Promise.all(clients.map((client) => client.close()))
  })

  it('isolates overlapping tool calls and denies a reader the write tool', async () => {
    const callers = Array.from({ length: 8 }, (_, index) => `caller-${index}`)
    const reader = await connect({ 'x-role': 'reader' })
    const writer = await connect({ 'x-role': 'writer' })
    const [results, denied, allowed] = await Promise.all([
      Promise.all(
        callers.map(async (caller, index) => {
          const client = await connect({ 'x-role': 'reader', 'x-caller': caller })
          const result = await client.callTool({ name: 'LeadsList', arguments: { delayMs: (8 - index) * 15 } })
          await client.close()
          return payload(result)
        })
      ),
      reader.callTool({ name: 'LeadsDelete', arguments: {} }).then(
        () => 'allowed',
        (error: unknown) => String(error)
      ),
      writer.callTool({ name: 'LeadsDelete', arguments: {} })
    ])
    expect(results).toEqual(callers.map((caller) => ({ caller })))
    expect(denied).toMatch(/Tool LeadsDelete not found/)
    expect(payload(allowed)).toEqual({ deleted: true })
    await Promise.all([reader.close(), writer.close()])
  })
})

describe('edge: client cancellation', () => {
  it('aborts the action signal when the client cancels, and keeps serving', async () => {
    const aborted = new Promise<string>((resolve) => {
      observeAbort = resolve
    })
    const running = new Promise<void>((resolve) => {
      started = resolve
    })
    const client = await connect({ 'x-role': 'reader' })
    const controller = new AbortController()
    const call = client.callTool({ name: 'SlowJob', arguments: {} }, { signal: controller.signal })
    await running
    controller.abort()
    await expect(call).rejects.toThrow()
    await expect(Promise.race([aborted, sleep(2000).then(() => 'timeout')])).resolves.toBe('aborted')

    const result = await client.callTool({ name: 'LeadsList', arguments: {} })
    expect(payload(result)).toEqual({})
    await client.close()
  })
})
