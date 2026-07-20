import { UnauthorizedError } from '@modelcontextprotocol/sdk/client/auth.js'
import { createContext } from '@silkweave/core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cliProxy, type CliProxyOptions } from './cliProxy.js'

const mocks = vi.hoisted(() => ({
  connect: vi.fn(),
  listTools: vi.fn(),
  callTool: vi.fn(),
  transportOptions: [] as unknown[]
}))

vi.mock('@modelcontextprotocol/sdk/client', () => ({
  Client: class {
    connect = mocks.connect
    listTools = mocks.listTools
    callTool = mocks.callTool
    setNotificationHandler = () => { }
  }
}))

vi.mock('@modelcontextprotocol/sdk/client/streamableHttp.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@modelcontextprotocol/sdk/client/streamableHttp.js')>()
  return {
    ...actual,
    StreamableHTTPClientTransport: class {
      constructor(_url: URL, options?: unknown) { mocks.transportOptions.push(options) }
      close = async () => { }
    }
  }
})

const TOOLS = [
  {
    name: 'CreateIdentity',
    description: 'Create an identity',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        count: { type: 'number' },
        verbose: { type: 'boolean' }
      },
      required: ['id']
    },
    _meta: { 'silkweave/args': ['id'] }
  },
  {
    name: 'AllocateTab',
    description: 'Allocate a tab',
    inputSchema: {
      type: 'object',
      properties: {
        identity: { type: 'string' },
        agentId: { type: 'string' },
        url: { type: 'string' }
      },
      required: ['identity', 'agentId']
    },
    _meta: { 'silkweave/args': ['identity', 'agentId', 'not-a-field'] }
  }
]

async function run(argv: string[], opts: Partial<CliProxyOptions> = {}) {
  const original = process.argv
  process.argv = ['node', 'test-cli', ...argv]
  try {
    const generator = cliProxy({ url: new URL('http://localhost:8080/mcp'), ...opts })
    const adapter = generator({ name: 'test-cli', description: 'Test CLI', version: '0.0.0' }, createContext())
    await adapter.start([])
  } finally {
    process.argv = original
  }
}

beforeEach(() => {
  mocks.connect.mockReset().mockResolvedValue(undefined)
  mocks.listTools.mockReset().mockResolvedValue({ tools: TOOLS })
  mocks.callTool.mockReset().mockResolvedValue({ content: [] })
  mocks.transportOptions.length = 0
  vi.spyOn(console, 'info').mockImplementation(() => { })
  vi.spyOn(console, 'error').mockImplementation(() => { })
})

afterEach(() => {
  vi.restoreAllMocks()
  process.exitCode = 0
})

describe('cliProxy auth passthrough', () => {
  it('merges headers over requestInit.headers on the transport', async () => {
    await run(['create-identity', 'abc'], {
      headers: { authorization: 'Bearer tok' },
      requestInit: { headers: { 'x-base': '1' } }
    })
    const { requestInit } = mocks.transportOptions[0] as { requestInit: RequestInit }
    const headers = new Headers(requestInit.headers)
    expect(headers.get('authorization')).toBe('Bearer tok')
    expect(headers.get('x-base')).toBe('1')
  })

  it('resolves a headers thunk once before connecting', async () => {
    const thunk = vi.fn(async () => ({ authorization: 'Bearer lazy' }))
    await run(['create-identity', 'abc'], { headers: thunk })
    expect(thunk).toHaveBeenCalledTimes(1)
    const { requestInit } = mocks.transportOptions[0] as { requestInit: RequestInit }
    expect(new Headers(requestInit.headers).get('authorization')).toBe('Bearer lazy')
  })

  it('passes fetch and authProvider through to the transport', async () => {
    const fetchImpl = vi.fn()
    const authProvider = {} as CliProxyOptions['authProvider']
    await run(['create-identity', 'abc'], { fetch: fetchImpl, authProvider })
    expect(mocks.transportOptions[0]).toMatchObject({ fetch: fetchImpl, authProvider })
  })
})

describe('cliProxy positional arguments', () => {
  it('maps a single positional into the tool call input', async () => {
    await run(['create-identity', 'abc', '--count', '2'])
    expect(mocks.callTool).toHaveBeenCalledWith(expect.objectContaining({
      name: 'CreateIdentity',
      arguments: { id: 'abc', count: 2 }
    }))
  })

  it('maps multiple positionals in silkweave/args order, dropping unknown keys', async () => {
    await run(['allocate-tab', 'default', 'cli', '--url', 'https://example.com'])
    expect(mocks.callTool).toHaveBeenCalledWith(expect.objectContaining({
      name: 'AllocateTab',
      arguments: { identity: 'default', agentId: 'cli', url: 'https://example.com' }
    }))
  })

  it('omits an optional positional that was not provided', async () => {
    const tools = [{
      name: 'ListSessions',
      inputSchema: { type: 'object', properties: { filter: { type: 'string' } } },
      _meta: { 'silkweave/args': ['filter'] }
    }]
    mocks.listTools.mockResolvedValue({ tools })
    await run(['list-sessions'])
    expect(mocks.callTool).toHaveBeenCalledWith(expect.objectContaining({
      name: 'ListSessions',
      arguments: {}
    }))
  })
})

describe('cliProxy connect failures', () => {
  it('prints a legible auth message and sets exitCode 1 on 401', async () => {
    mocks.connect.mockRejectedValue(new UnauthorizedError('nope'))
    await run(['create-identity', 'abc'])
    expect(mocks.callTool).not.toHaveBeenCalled()
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('authentication failed'))
    expect(process.exitCode).toBe(1)
  })

  it('prints a legible transport message on other connect errors', async () => {
    mocks.connect.mockRejectedValue(new Error('ECONNREFUSED'))
    await run(['create-identity', 'abc'])
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('cannot reach MCP server'))
    expect(process.exitCode).toBe(1)
  })

  it('degrades a bare invocation to base help with a note when offline', async () => {
    mocks.connect.mockRejectedValue(new Error('ECONNREFUSED'))
    const help = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    await run([])
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('remote tools unavailable'))
    expect(help).toHaveBeenCalled()
    expect(process.exitCode).toBe(1)
  })
})
