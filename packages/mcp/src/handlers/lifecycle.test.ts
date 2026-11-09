import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import { createContext, defineSkill, type Action, type SilkweaveContext } from '@silkweave/core'
import express from 'express'
import { type Server } from 'http'
import { type AddressInfo } from 'net'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { z } from 'zod/v4'
import { AUTH_REQUEST_KEY } from './auth.js'
import { type FilterActions } from './filter.js'
import { mcpTransport, type McpTransportOptions } from './transport.js'

// Request-lifecycle edges of the stateless Node transport, driven by the real
// MCP SDK v2 client on protocol 2026-07-28: concurrent requests with different
// per-request tool filters, client cancellation mid-call, and server-setup
// failures (skill boot, per-request server factory).

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

type Extra = { mcpReq: { signal: AbortSignal } }

/** Resolves once the slow action observed its request's abort signal. */
let observeAbort: (reason: string) => void = () => undefined
let started: () => void = () => undefined

const actions = [
  {
    name: 'leads.list',
    description: 'List leads, echoing the caller role after a delay',
    tags: ['read'],
    input: z.object({ delayMs: z.number().default(0) }),
    run: async ({ delayMs }: { delayMs: number }, context: SilkweaveContext) => {
      await sleep(delayMs)
      const request = context.get('request') as { headers: Record<string, string> }
      const auth = context.getOptional<{ clientId: string }>('auth')
      return { role: request.headers['x-role'], caller: request.headers['x-caller'], authed: auth?.clientId }
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

/** Async + jittered so concurrent requests interleave inside the filter. */
const roleFilter: FilterActions = async (all, request) => {
  await sleep(Math.random() * 20)
  const role = request.headers['x-role']
  if (role === 'dupes') {
    // Registering the same tool twice throws inside the per-request server
    // factory - a stand-in for any server-setup failure after filtering.
    return [...all, ...all]
  }
  return role === 'writer' ? all : all.filter((action) => action.tags?.includes('read'))
}

function serve(options: McpTransportOptions): { server: Server; url: URL; ready: Promise<void> } {
  const app = express()
  const transport = mcpTransport(
    { name: 'lifecycle', description: 'lifecycle', version: '0.0.0' },
    createContext({ adapter: 'http' }),
    actions,
    options
  )
  // Stand-in for authMiddleware: attach a per-request AuthInfo that
  // mcpTransport forks into this request's context.
  const attachAuth: express.RequestHandler = (req, _res, next) => {
    const caller = req.headers['x-caller']
    if (typeof caller === 'string') {
      ;(req as unknown as Record<symbol | string, unknown>)[AUTH_REQUEST_KEY] = {
        token: caller,
        clientId: caller,
        scopes: []
      }
    }
    next()
  }
  app.post('/mcp', express.json(), attachAuth, transport.post)
  const server = app.listen(0)
  const url = new URL(`http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`)
  return { server, url, ready: transport.ready }
}

async function connect(url: URL, headers: Record<string, string>) {
  const client = new Client(
    { name: 'lifecycle-client', version: '0.0.0' },
    { versionNegotiation: { mode: { pin: '2026-07-28' } } }
  )
  await client.connect(new StreamableHTTPClientTransport(url, { requestInit: { headers } }))
  return client
}

function payload(result: { content?: unknown }) {
  const [block] = result.content as { type: string; text: string }[]
  return JSON.parse(block.text) as Record<string, unknown>
}

let main: ReturnType<typeof serve>

beforeAll(() => {
  main = serve({ filterActions: roleFilter })
})

afterAll(() => new Promise<void>((resolve) => main.server.close(() => resolve())))

describe('concurrent requests with different tool filters', () => {
  it('computes each tool list from its own request, never a neighbour', async () => {
    const roles = Array.from({ length: 16 }, (_, index) => (index % 2 === 0 ? 'reader' : 'writer'))
    const clients = await Promise.all(roles.map((role) => connect(main.url, { 'x-role': role })))
    const lists = await Promise.all(clients.map((client) => client.listTools()))
    lists.forEach(({ tools }, index) => {
      const names = tools.map((tool) => tool.name).sort()
      expect(names).toEqual(
        roles[index] === 'writer' ? ['LeadsDelete', 'LeadsList', 'SlowJob'] : ['LeadsList', 'SlowJob']
      )
    })
    await Promise.all(clients.map((client) => client.close()))
  })

  it('isolates the request context of overlapping tool calls', async () => {
    // Inverse delays so the first call finishes last: a context leaked between
    // requests (shared mutable state, a wrong fork) shows up as a swapped caller.
    // `caller` comes from the SDK's per-call HTTP request, `authed` from the
    // auth mcpTransport forks into the per-request silkweave context.
    const callers = Array.from({ length: 8 }, (_, index) => `caller-${index}`)
    const results = await Promise.all(
      callers.map(async (caller, index) => {
        const client = await connect(main.url, { 'x-role': 'reader', 'x-caller': caller })
        const result = await client.callTool({ name: 'LeadsList', arguments: { delayMs: (8 - index) * 15 } })
        await client.close()
        return payload(result)
      })
    )
    expect(results).toEqual(callers.map((caller) => ({ role: 'reader', caller, authed: caller })))
  })

  it('denies a reader the write tool while a concurrent writer call succeeds', async () => {
    const [reader, writer] = await Promise.all([
      connect(main.url, { 'x-role': 'reader' }),
      connect(main.url, { 'x-role': 'writer' })
    ])
    const [denied, allowed] = await Promise.allSettled([
      reader.callTool({ name: 'LeadsDelete', arguments: {} }),
      writer.callTool({ name: 'LeadsDelete', arguments: {} })
    ])
    // The filtered-out tool does not exist on the reader's per-request server.
    expect(denied.status).toBe('rejected')
    expect(String((denied as PromiseRejectedResult).reason)).toMatch(/Tool LeadsDelete not found/)
    expect(allowed.status).toBe('fulfilled')
    expect(payload((allowed as PromiseFulfilledResult<{ content?: unknown }>).value)).toEqual({ deleted: true })
    await Promise.all([reader.close(), writer.close()])
  })
})

describe('client cancellation', () => {
  it('aborts the action signal when the client cancels, and keeps serving', async () => {
    const aborted = new Promise<string>((resolve) => {
      observeAbort = resolve
    })
    const running = new Promise<void>((resolve) => {
      started = resolve
    })
    const client = await connect(main.url, { 'x-role': 'reader' })
    const controller = new AbortController()
    const call = client.callTool({ name: 'SlowJob', arguments: {} }, { signal: controller.signal })
    await running
    controller.abort()
    await expect(call).rejects.toThrow()
    // The disconnect reaches the action well before its 5s fallback timer.
    await expect(Promise.race([aborted, sleep(2000).then(() => 'timeout')])).resolves.toBe('aborted')

    // The server is unharmed: the next call on the same endpoint succeeds.
    const result = await client.callTool({ name: 'LeadsList', arguments: {} })
    expect(payload(result)).toMatchObject({ role: 'reader' })
    await client.close()
  })
})

describe('server-setup failures', () => {
  it('answers a per-request server-factory failure with a JSON-RPC 500, then recovers', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const seen: { status: number; body: string }[] = []
    const client = new Client(
      { name: 'lifecycle-client', version: '0.0.0' },
      { versionNegotiation: { mode: { pin: '2026-07-28' } } }
    )
    const transport = new StreamableHTTPClientTransport(main.url, {
      requestInit: { headers: { 'x-role': 'dupes' } },
      fetch: async (input, init) => {
        const res = await fetch(input, init)
        seen.push({ status: res.status, body: await res.clone().text() })
        return res
      }
    })
    try {
      await expect(client.connect(transport)).rejects.toThrow()
      // A real 2026-07-28 request reached the factory (not an era rejection)...
      expect(errors.mock.calls.flat().map(String).join('\n')).toMatch(/already registered/)
      // ...and the failure surfaced as a JSON-RPC internal error, not a hang.
      expect(seen.at(-1)?.status).toBe(500)
      expect(JSON.parse(seen.at(-1)!.body)).toMatchObject({ jsonrpc: '2.0', error: { code: -32_603 } })
    } finally {
      errors.mockRestore()
    }

    // One request's broken setup does not poison the shared handler.
    const healthy = await connect(main.url, { 'x-role': 'writer' })
    expect((await healthy.listTools()).tools).toHaveLength(3)
    await healthy.close()
  })

  it('rejects ready on a skill boot failure and 500s every request instead of hanging', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const broken = serve({ skills: [defineSkill({ dir: '/nonexistent/silkweave-skill' })] })
    try {
      await expect(broken.ready).rejects.toThrow()
      const res = await fetch(broken.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'server/discover', params: {} })
      })
      expect(res.status).toBe(500)
      expect(((await res.json()) as { error: { code: number } }).error.code).toBe(-32_603)
    } finally {
      errors.mockRestore()
      await new Promise<void>((resolve) => broken.server.close(() => resolve()))
    }
  })
})
