import { Client, StreamableHTTPClientTransport, type VersionNegotiationMode } from '@modelcontextprotocol/client'
import { createContext, type Action, type SilkweaveContext } from '@silkweave/core'
import express from 'express'
import { type Server } from 'http'
import { type AddressInfo } from 'net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { z } from 'zod/v4'
import { mcpTransport } from './transport.js'

// End-to-end over real HTTP: the MCP SDK v2 client in both protocol eras
// against the Node `mcpTransport()` handler (2026-07-28 natively, 2025-era via
// the SDK's stateless legacy leg).

const actions = [
  {
    name: 'echo.header',
    description: 'Echo a request header and the input',
    input: z.object({ text: z.string(), times: z.number().default(1) }),
    run: async ({ text, times }: { text: string; times: number }, context: SilkweaveContext) => {
      const request = context.get('request') as { headers: Record<string, string> } | undefined
      return { text: text.repeat(times), header: request?.headers['x-test'] ?? null }
    }
  },
  {
    name: 'count.up',
    description: 'Stream a few chunks',
    input: z.object({ count: z.number() }),
    chunk: z.object({ index: z.number() }),
    run: async function* ({ count }: { count: number }) {
      for (let index = 0; index < count; index += 1) {
        yield { index }
      }
    }
  }
] as unknown as Action[]

let strict: Server
let compat: Server
let strictUrl: URL
let compatUrl: URL

function serve(legacy: boolean): [Server, URL] {
  const app = express()
  const transport = mcpTransport(
    { name: 'eras', description: 'A long free-text server description', version: '0.0.0' },
    createContext({ adapter: 'http' }),
    actions,
    { legacy }
  )
  app.post('/mcp', express.json(), transport.post)
  const server = app.listen(0)
  return [server, new URL(`http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`)]
}

beforeAll(() => {
  ;[strict, strictUrl] = serve(false)
  ;[compat, compatUrl] = serve(true)
})

afterAll(() => {
  strict.close()
  compat.close()
})

async function connectTo(url: URL, mode: VersionNegotiationMode) {
  const client = new Client({ name: 'eras-client', version: '0.0.0' }, { versionNegotiation: { mode } })
  await client.connect(new StreamableHTTPClientTransport(url, { requestInit: { headers: { 'x-test': 'hello' } } }))
  return client
}

describe('protocol policy', () => {
  it('rejects a 2025-era client by default', async () => {
    await expect(connectTo(strictUrl, 'legacy')).rejects.toThrow()
  })

  it('serves a 2025-era client with legacy: true', async () => {
    const client = await connectTo(compatUrl, 'legacy')
    expect((await client.listTools()).tools.length).toBeGreaterThan(0)
    await client.close()
  })

  it('stamps a slim serverInfo (no description) on 2026-07-28 tool results only', async () => {
    const modern = await connectTo(strictUrl, { pin: '2026-07-28' })
    const result = await modern.callTool({ name: 'EchoHeader', arguments: { text: 'a' } })
    expect(result._meta?.['io.modelcontextprotocol/serverInfo']).toEqual({ name: 'eras', version: '0.0.0' })
    await modern.close()
    const legacy = await connectTo(compatUrl, 'legacy')
    const old = await legacy.callTool({ name: 'EchoHeader', arguments: { text: 'a' } })
    expect(old._meta?.['io.modelcontextprotocol/serverInfo']).toBeUndefined()
    await legacy.close()
  })
})

describe.each([
  ['modern (2026-07-28)', { pin: '2026-07-28' } as VersionNegotiationMode, false],
  ['legacy (2025)', 'legacy' as VersionNegotiationMode, true]
])('mcpTransport with a %s client', (_label, mode, legacy) => {
  const connect = (negotiation: VersionNegotiationMode) => connectTo(legacy ? compatUrl : strictUrl, negotiation)

  it('lists tools with JSON Schema derived from the zod input', async () => {
    const client = await connect(mode)
    const { tools } = await client.listTools()
    const echo = tools.find((tool) => tool.name === 'EchoHeader')
    expect(echo?.inputSchema).toMatchObject({
      type: 'object',
      properties: { text: { type: 'string' }, times: { type: 'number' } },
      required: ['text']
    })
    await client.close()
  })

  it('calls a tool with zod defaults applied and request headers visible to the action', async () => {
    const client = await connect(mode)
    const result = await client.callTool({ name: 'EchoHeader', arguments: { text: 'ab' } })
    expect(result.isError).toBeFalsy()
    const [block] = result.content as { type: string; text: string }[]
    expect(JSON.parse(block.text)).toEqual({ text: 'ab', header: 'hello' })
    await client.close()
  })

  it('rejects invalid arguments with zod validation semantics', async () => {
    const client = await connect(mode)
    const outcome = await client.callTool({ name: 'EchoHeader', arguments: { text: 42 } }).then(
      (result) => ({ isError: result.isError === true }),
      () => ({ isError: true })
    )
    expect(outcome.isError).toBe(true)
    await client.close()
  })

  it('streams chunks as progress notifications when a progressToken is sent', async () => {
    const client = await connect(mode)
    const messages: string[] = []
    const result = await client.callTool(
      { name: 'CountUp', arguments: { count: 3 } },
      { onprogress: (progress) => messages.push(progress.message ?? '') }
    )
    expect(result.isError).toBeFalsy()
    expect(messages.map((message) => JSON.parse(message))).toEqual([{ index: 0 }, { index: 1 }, { index: 2 }])
    await client.close()
  })
})
