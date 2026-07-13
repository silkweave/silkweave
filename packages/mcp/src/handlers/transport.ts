import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { Action, SilkweaveContext, SilkweaveOptions, validateActionDisposition } from '@silkweave/core'
import { type RequestHandler } from 'express'
import { registerTools } from './registerTools.js'

function createMcpServer(options: SilkweaveOptions, actions: Action[], context: SilkweaveContext): McpServer {
  const server = new McpServer({
    name: options.name,
    description: options.description,
    version: options.version
  }, {
    capabilities: { tools: {}, logging: {} }
  })
  registerTools(server, actions, context)
  return server
}

export interface McpTransportHandlers {
  /** `POST /mcp` - handle a single stateless MCP request/response (SSE per call). */
  post: RequestHandler
}

/**
 * Build the MCP Streamable HTTP transport route handler.
 *
 * Stateless (per the 2026 spec direction): each `POST /mcp` mints a fresh
 * transport + server with `sessionIdGenerator: undefined`, handles exactly that
 * request (streaming progress over SSE when the call carries a `progressToken`),
 * and tears down on response close. No `Mcp-Session-Id`, no session map, no
 * `GET`/`DELETE` reconnect - any request can hit any instance.
 */
export function mcpTransport(
  silkweaveOptions: SilkweaveOptions,
  context: SilkweaveContext,
  actions: Action[]
): McpTransportHandlers {
  // Fail at boot, not per request - the factory runs once when the app is built.
  actions.forEach(validateActionDisposition)

  const post: RequestHandler = async (req, res) => {
    try {
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined })
      const server = createMcpServer(silkweaveOptions, actions, context)
      res.on('close', () => { void transport.close(); void server.close() })
      await server.connect(transport)
      await transport.handleRequest(req, res, req.body)
    } catch (error) {
      console.error('Error handling MCP request:', error)
      if (!res.headersSent) {
        res.status(500).json({ jsonrpc: '2.0', error: { code: -32_603, message: 'Internal server error' }, id: null })
      }
    }
  }

  return { post }
}
