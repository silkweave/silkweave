import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { binary, createContext, resource, SilkweaveError, type Action, type ToolCallEvent } from '@silkweave/core'
import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod/v4'
import { registerTools, type RegisterToolsOptions } from './registerTools.js'

/** Register `actions` on a fresh server and connect an SDK client to it in-memory. */
async function connect(actions: Action[], options: RegisterToolsOptions = {}) {
  const server = new McpServer({ name: 'test', version: '0.0.0' }, { capabilities: { tools: {}, logging: {} } })
  registerTools(server, actions, createContext(), { logStream: false, ...options })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  const client = new Client({ name: 'test-client', version: '0.0.0' })
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)])
  return client
}

function action(overrides: Partial<Action>): Action {
  return {
    name: 'hello.world',
    description: 'Say hello',
    input: z.object({ name: z.string() }),
    run: async ({ name }: { name: string }) => ({ greeting: `Hello ${name}` }),
    ...overrides
  } as Action
}

describe('registerTools annotations', () => {
  it('derives readOnlyHint: true for query actions', async () => {
    const client = await connect([action({ kind: 'query' })])
    const { tools } = await client.listTools()
    expect(tools[0].annotations).toMatchObject({ readOnlyHint: true })
  })

  it('derives readOnlyHint: false for mutations (the default kind)', async () => {
    const client = await connect([action({})])
    const { tools } = await client.listTools()
    expect(tools[0].annotations).toMatchObject({ readOnlyHint: false })
  })

  it('merges explicit annotations over the derived base', async () => {
    const client = await connect([action({ annotations: { destructiveHint: true } })])
    const { tools } = await client.listTools()
    expect(tools[0].annotations).toMatchObject({ readOnlyHint: false, destructiveHint: true })
  })

  it('lets an explicit readOnlyHint override the kind derivation', async () => {
    const client = await connect([action({ kind: 'query', annotations: { readOnlyHint: false } })])
    const { tools } = await client.listTools()
    expect(tools[0].annotations).toMatchObject({ readOnlyHint: false })
  })

  it('lifts a curated annotations.title to the top-level title, keeping it in annotations', async () => {
    const client = await connect([action({ annotations: { title: 'Checking what you have open' } })])
    const { tools } = await client.listTools()
    expect(tools[0].title).toBe('Checking what you have open')
    expect(tools[0].annotations).toMatchObject({ title: 'Checking what you have open' })
  })

  it('falls back to the derived title when the action declares none', async () => {
    const client = await connect([action({})])
    const { tools } = await client.listTools()
    expect(tools[0].title).toBe('Hello World')
    expect(tools[0].annotations?.title).toBeUndefined()
  })
})

describe('registerTools positional args _meta', () => {
  it('publishes action.args as silkweave/args tool _meta', async () => {
    const client = await connect([action({ args: ['name'] })])
    const { tools } = await client.listTools()
    expect(tools[0]._meta).toMatchObject({ 'silkweave/args': ['name'] })
  })

  it('emits no silkweave/args _meta when the action declares none', async () => {
    const client = await connect([action({})])
    const { tools } = await client.listTools()
    expect(tools[0]._meta?.['silkweave/args']).toBeUndefined()
  })
})

interface TextBlock {
  type: 'text'
  text: string
}

describe('registerTools structured output', () => {
  const structured = () =>
    action({
      name: 'users.get',
      disposition: 'structured',
      output: z.object({ id: z.string(), label: z.string() }),
      run: async () => ({ id: 'u1', label: 'Ada', extra: 'dropped' })
    })

  it('forwards outputSchema to tools/list only for structured actions', async () => {
    const client = await connect([structured(), action({})])
    const { tools } = await client.listTools()
    const byName = Object.fromEntries(tools.map((t) => [t.name, t]))
    expect(byName.UsersGet.outputSchema).toBeDefined()
    expect(byName.HelloWorld.outputSchema).toBeUndefined()
  })

  it('ships schema-parsed structuredContent - extra fields stripped, SDK client validation passing', async () => {
    const client = await connect([structured()])
    // client.callTool validates structuredContent against the declared JSON
    // Schema (additionalProperties: false) - this passing at all proves the
    // parse-then-ship strip.
    const result = await client.callTool({ name: 'UsersGet', arguments: { name: 'x' } })
    expect(result.structuredContent).toEqual({ id: 'u1', label: 'Ada' })
    expect(JSON.parse((result.content as TextBlock[])[0].text)).toEqual({ id: 'u1', label: 'Ada' })
  })

  it('degrades a genuine schema mismatch to an isError tool result, not a protocol error', async () => {
    const bad = action({
      name: 'users.bad',
      disposition: 'structured',
      output: z.object({ id: z.string() }),
      run: async () => ({ nope: 1 })
    })
    const client = await connect([bad])
    const result = await client.callTool({ name: 'UsersBad', arguments: { name: 'x' } })
    expect(result.isError).toBe(true)
    const text = (result.content as TextBlock[])[0].text
    expect(text).toContain('output_validation_error')
    expect(text).toContain('id')
  })

  it('ignores _meta.disposition on structured actions (the contract cannot be demoted)', async () => {
    const blob = 'x'.repeat(5000)
    const big = action({
      name: 'users.big',
      disposition: 'structured',
      output: z.object({ blob: z.string() }),
      run: async () => ({ blob })
    })
    const client = await connect([big])
    const result = await client.callTool({
      name: 'UsersBig',
      arguments: { name: 'x' },
      _meta: { disposition: 'smart' }
    })
    expect(result.structuredContent).toEqual({ blob })
    // No smart sideloading: the text mirror carries the full JSON payload.
    expect((result.content as TextBlock[])[0].type).toBe('text')
    expect((result.content as TextBlock[]).length).toBe(1)
  })
})

describe('registerTools default disposition (json)', () => {
  const big = { blob: 'x'.repeat(5000) }

  it('defaults to compact JSON - a large payload is not sideloaded', async () => {
    const client = await connect([action({ run: async () => big })])
    const result = await client.callTool({ name: 'HelloWorld', arguments: { name: 'x' } })
    expect(result.content).toHaveLength(1)
    expect((result.content as TextBlock[])[0].text).toBe(JSON.stringify(big))
  })

  it('a client _meta.disposition of smart opts back into sideloading', async () => {
    const client = await connect([action({ run: async () => big })])
    const result = await client.callTool({
      name: 'HelloWorld',
      arguments: { name: 'x' },
      _meta: { disposition: 'smart' }
    })
    const content = result.content as { type: string }[]
    expect(content.some((block) => block.type === 'resource')).toBe(true)
  })

  it('disposition: smart on the action still sideloads large payloads', async () => {
    const client = await connect([action({ disposition: 'smart', run: async () => big })])
    const result = await client.callTool({ name: 'HelloWorld', arguments: { name: 'x' } })
    const content = result.content as { type: string }[]
    expect(content.some((block) => block.type === 'resource')).toBe(true)
  })
})

describe('registerTools resource results', () => {
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47])
  const screenshot = (overrides: Partial<Action> = {}) =>
    action({
      name: 'take.screenshot',
      output: binary({ mimeType: 'image/png' }),
      run: async () => resource(png, { mimeType: 'image/png', description: 'Screenshot of example.com' }),
      ...overrides
    })

  it('delivers a resource() image as text description + image block', async () => {
    const client = await connect([screenshot()])
    const result = await client.callTool({ name: 'TakeScreenshot', arguments: { name: 'x' } })
    const content = result.content as { type: string; text?: string; mimeType?: string; data?: string }[]
    expect(content).toHaveLength(2)
    expect(content[0]).toEqual({ type: 'text', text: 'Screenshot of example.com' })
    expect(content[1]).toMatchObject({ type: 'image', mimeType: 'image/png' })
    expect(Buffer.from(content[1].data!, 'base64')).toEqual(Buffer.from(png))
  })

  it('normalizes a bare Uint8Array return using the binary() schema mime type', async () => {
    const client = await connect([screenshot({ run: async () => png })])
    const result = await client.callTool({ name: 'TakeScreenshot', arguments: { name: 'x' } })
    const content = result.content as { type: string; mimeType?: string }[]
    expect(content[0]).toMatchObject({ type: 'image', mimeType: 'image/png' })
  })

  it('normalizes a returned File - its own name and type win', async () => {
    const client = await connect([
      screenshot({
        run: async () => new File(['{"report":true}'], 'report.json', { type: 'application/json' })
      })
    ])
    const result = await client.callTool({ name: 'TakeScreenshot', arguments: { name: 'x' } })
    const [block] = result.content as [{ type: string; resource: { uri: string; text: string } }]
    expect(block.type).toBe('resource')
    expect(block.resource.text).toBe('{"report":true}')
    expect(block.resource.uri).toContain('report.json')
  })

  it('handles resource-like results on actions with no binary() declaration', async () => {
    const client = await connect([action({ run: async () => resource('# hi', { mimeType: 'text/markdown' }) })])
    const result = await client.callTool({ name: 'HelloWorld', arguments: { name: 'x' } })
    expect((result.content as { type: string }[])[0].type).toBe('resource')
  })

  it('a client _meta.disposition cannot demote a resource result', async () => {
    const client = await connect([screenshot()])
    const result = await client.callTool({
      name: 'TakeScreenshot',
      arguments: { name: 'x' },
      _meta: { disposition: 'smart' }
    })
    const content = result.content as { type: string }[]
    expect(content.some((block) => block.type === 'image')).toBe(true)
  })

  it('a toolResult hook still wins over resource mapping', async () => {
    const client = await connect([
      screenshot({
        toolResult: () => ({ content: [{ type: 'text', text: 'hooked' }] })
      })
    ])
    const result = await client.callTool({ name: 'TakeScreenshot', arguments: { name: 'x' } })
    expect(result.content).toEqual([{ type: 'text', text: 'hooked' }])
  })

  it('telemetry counts payload bytes and does not report sideloaded', async () => {
    const events: ToolCallEvent[] = []
    const client = await connect(
      [
        screenshot({
          run: async () => resource(png, { mimeType: 'application/pdf' })
        })
      ],
      {
        onToolCall: (event) => {
          events.push(event)
        }
      }
    )
    await client.callTool({ name: 'TakeScreenshot', arguments: { name: 'x' } })
    expect(events[0]).toMatchObject({ ok: true, resultBytes: png.length, sideloaded: false })
  })
})

describe('registerTools onToolCall telemetry', () => {
  const collect = () => {
    const events: ToolCallEvent[] = []
    return {
      events,
      onToolCall: (event: ToolCallEvent) => {
        events.push(event)
      }
    }
  }

  it('emits one event per successful call with result metadata', async () => {
    const { events, onToolCall } = collect()
    const client = await connect([action({})], { onToolCall })
    await client.callTool({ name: 'HelloWorld', arguments: { name: 'Ada' } })
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      action: 'hello.world',
      tool: 'HelloWorld',
      transport: 'mcp',
      ok: true,
      sideloaded: false,
      resultBytes: JSON.stringify({ greeting: 'Hello Ada' }).length
    })
    expect(events[0].durationMs).toBeTypeOf('number')
    expect(events[0].context.getOptional('logger')).toBeDefined()
  })

  it('carries the parsed (post-zod) input as args - defaults applied', async () => {
    const { events, onToolCall } = collect()
    const withDefault = action({
      input: z.object({ name: z.string(), limit: z.number().default(10) }),
      run: async () => ({ ok: true })
    })
    const client = await connect([withDefault], { onToolCall })
    await client.callTool({ name: 'HelloWorld', arguments: { name: 'Ada' } })
    expect(events[0].args).toEqual({ name: 'Ada', limit: 10 })
  })

  it('carries args on thrown-error events too', async () => {
    const { events, onToolCall } = collect()
    const failing = action({
      run: async () => {
        throw new SilkweaveError('nope', 'forbidden', 403)
      }
    })
    const client = await connect([failing], { onToolCall })
    await client.callTool({ name: 'HelloWorld', arguments: { name: 'Ada' } })
    expect(events[0]).toMatchObject({ ok: false, args: { name: 'Ada' } })
  })

  it('reports sideloaded: true when smartToolResult offloads a large payload', async () => {
    const { events, onToolCall } = collect()
    const big = { blob: 'x'.repeat(5000) }
    const client = await connect([action({ disposition: 'smart', run: async () => big })], { onToolCall })
    await client.callTool({ name: 'HelloWorld', arguments: { name: 'x' } })
    expect(events[0]).toMatchObject({ ok: true, sideloaded: true })
  })

  it('emits ok: false with the SilkweaveError code when the action throws', async () => {
    const { events, onToolCall } = collect()
    const failing = action({
      run: async () => {
        throw new SilkweaveError('nope', 'forbidden', 403)
      }
    })
    const client = await connect([failing], { onToolCall })
    const result = await client.callTool({ name: 'HelloWorld', arguments: { name: 'x' } })
    expect(result.isError).toBe(true)
    expect(events[0]).toMatchObject({ ok: false, errorCode: 'forbidden', errorMessage: 'nope' })
    expect(events[0].resultBytes).toBeUndefined()
  })

  it('never fails or slows the call when the hook throws or rejects', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const client = await connect([action({})], {
      onToolCall: () => {
        throw new Error('telemetry down')
      }
    })
    const result = await client.callTool({ name: 'HelloWorld', arguments: { name: 'Ada' } })
    expect(result.isError).toBeUndefined()
    const asyncClient = await connect([action({})], {
      onToolCall: async () => {
        throw new Error('telemetry down')
      }
    })
    const asyncResult = await asyncClient.callTool({ name: 'HelloWorld', arguments: { name: 'Ada' } })
    expect(asyncResult.isError).toBeUndefined()
    spy.mockRestore()
  })
})
