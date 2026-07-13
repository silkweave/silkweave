import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { createContext, type Action } from '@silkweave/core'
import { describe, expect, it } from 'vitest'
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
})

interface TextBlock { type: 'text'; text: string }

describe('registerTools structured output', () => {
  const structured = () => action({
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
    const result = await client.callTool({ name: 'UsersBig', arguments: { name: 'x' }, _meta: { disposition: 'smart' } })
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
    const result = await client.callTool({ name: 'HelloWorld', arguments: { name: 'x' }, _meta: { disposition: 'smart' } })
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
