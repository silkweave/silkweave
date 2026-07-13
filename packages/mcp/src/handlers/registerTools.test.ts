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
