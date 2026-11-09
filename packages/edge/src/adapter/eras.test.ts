import { Client, StreamableHTTPClientTransport, type VersionNegotiationMode } from '@modelcontextprotocol/client'
import { createContext, type Action, type SilkweaveContext } from '@silkweave/core'
import { beforeAll, describe, expect, it } from 'vitest'
import { z } from 'zod/v4'
import { edge } from './edge.js'

// End-to-end through the Web-Standard handler: the MCP SDK v2 client in both
// protocol eras, with and without `enableJsonResponse` (2025-era traffic is
// routed to a v1-identical stateless transport so that option keeps applying).

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

const url = new URL('http://localhost/mcp')

async function startEdge(enableJsonResponse: boolean) {
  const app = edge({ enableJsonResponse })
  const generated = app.adapter({ name: 'eras', description: 'eras', version: '0.0.0' }, createContext())
  await generated.start(actions)
  return app
}

let app: Awaited<ReturnType<typeof startEdge>>

async function connect(mode: VersionNegotiationMode) {
  const client = new Client({ name: 'eras-client', version: '0.0.0' }, { versionNegotiation: { mode } })
  await client.connect(
    new StreamableHTTPClientTransport(url, {
      requestInit: { headers: { 'x-test': 'hello' } },
      fetch: (input, init) => app.handler(new Request(input, init))
    })
  )
  return client
}

describe.each([
  ['modern (2026-07-28)', { pin: '2026-07-28' } as VersionNegotiationMode, false],
  ['legacy (2025)', 'legacy' as VersionNegotiationMode, false],
  ['modern (2026-07-28)', { pin: '2026-07-28' } as VersionNegotiationMode, true],
  ['legacy (2025)', 'legacy' as VersionNegotiationMode, true]
])('edge with a %s client (enableJsonResponse: %s)', (_label, mode, json) => {
  beforeAll(async () => {
    app = await startEdge(json)
  })

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
    // A single JSON response body cannot carry mid-call notifications - the
    // documented trade-off of enableJsonResponse (same as the v1 transport).
    expect(messages.map((message) => JSON.parse(message))).toEqual(
      json ? [] : [{ index: 0 }, { index: 1 }, { index: 2 }]
    )
    await client.close()
  })
})
