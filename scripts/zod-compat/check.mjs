import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import { createMcpHandler, McpServer } from '@modelcontextprotocol/server'
import { createContext } from '@silkweave/core'
import { registerTools } from '@silkweave/mcp'
import { z } from 'zod/v4'

const Node = z.object({
  name: z.string(),
  get children() {
    return z.array(Node).optional()
  }
})
const actions = [
  {
    name: 'kitchen.sink',
    description: 'Exercise zod features',
    input: z.object({
      text: z.string().min(1),
      times: z.number().int().default(2),
      count: z.coerce.number(),
      shout: z
        .string()
        .transform((s) => s.toUpperCase())
        .optional(),
      mode: z.enum(['a', 'b']).default('a'),
      maybe: z.string().nullable().optional(),
      either: z.union([z.string(), z.number()]).optional(),
      tree: Node.optional()
    }),
    run: async (input) => input
  },
  {
    name: 'users.get',
    description: 'Structured output',
    disposition: 'structured',
    input: z.object({ id: z.string() }),
    output: z.object({ id: z.string(), label: z.string(), tags: z.array(z.string()).default([]) }),
    run: async ({ id }) => ({ id, label: 'Ada', extra: 'stripped' })
  }
]

const handler = createMcpHandler(
  () => {
    const server = new McpServer({ name: 'zodfix', version: '0' }, { capabilities: { tools: {}, logging: {} } })
    registerTools(server, actions, createContext(), { logStream: false })
    return server
  },
  { legacy: 'stateless' }
)

let failures = 0
const check = (label, cond, detail) => {
  if (!cond) {
    failures++
    console.log('FAIL', label, detail ?? '')
  } else console.log('ok  ', label)
}

for (const mode of [{ pin: '2026-07-28' }, 'legacy']) {
  const tag = typeof mode === 'string' ? 'legacy' : 'modern'
  const client = new Client({ name: 'c', version: '0' }, { versionNegotiation: { mode } })
  await client.connect(
    new StreamableHTTPClientTransport(new URL('http://x/mcp'), { fetch: (u, i) => handler.fetch(new Request(u, i)) })
  )
  const { tools } = await client.listTools()
  const sink = tools.find((t) => t.name === 'KitchenSink')
  check(
    `${tag} inputSchema properties`,
    sink && Object.keys(sink.inputSchema.properties).length === 8,
    JSON.stringify(sink?.inputSchema).slice(0, 300)
  )
  check(
    `${tag} required excludes defaults`,
    JSON.stringify(sink.inputSchema.required?.sort()) === JSON.stringify(['count', 'text']),
    JSON.stringify(sink.inputSchema.required)
  )
  check(`${tag} recursive schema emitted`, JSON.stringify(sink.inputSchema).includes('children'))
  const r = await client.callTool({
    name: 'KitchenSink',
    arguments: {
      text: 'hi',
      count: '7',
      shout: 'hey',
      maybe: null,
      either: 3,
      tree: { name: 'root', children: [{ name: 'leaf' }] }
    }
  })
  const out = JSON.parse(r.content[0].text)
  check(`${tag} defaults applied`, out.times === 2 && out.mode === 'a', JSON.stringify(out))
  check(`${tag} coercion applied`, out.count === 7, JSON.stringify(out))
  check(`${tag} transform applied`, out.shout === 'HEY', JSON.stringify(out))
  check(
    `${tag} nullable/union/recursion`,
    out.maybe === null && out.either === 3 && out.tree.children[0].name === 'leaf',
    JSON.stringify(out)
  )
  const bad = await client.callTool({ name: 'KitchenSink', arguments: { text: '', count: 'x' } }).then(
    (x) => x.isError === true,
    () => true
  )
  check(`${tag} invalid input rejected`, bad)
  const users = tools.find((t) => t.name === 'UsersGet')
  check(
    `${tag} outputSchema emitted`,
    users?.outputSchema?.properties?.label?.type === 'string',
    JSON.stringify(users?.outputSchema)
  )
  const s = await client.callTool({ name: 'UsersGet', arguments: { id: 'u1' } })
  check(
    `${tag} structured content parsed+stripped`,
    JSON.stringify(s.structuredContent) === JSON.stringify({ id: 'u1', label: 'Ada', tags: [] }),
    JSON.stringify(s.structuredContent) + ' isError=' + s.isError
  )
  await client.close()
}
console.log(failures ? `${failures} FAILURES` : 'ALL OK')
process.exit(failures ? 1 : 0)
