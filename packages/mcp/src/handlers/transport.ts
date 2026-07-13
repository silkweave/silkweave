import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { Action, OnToolCall, SilkweaveContext, SilkweaveOptions, validateActionDisposition } from '@silkweave/core'
import { type RequestHandler } from 'express'
import { filterErrorResponse, rpcInfo, type FilterActions } from './filter.js'
import { registerTools } from './registerTools.js'

function createMcpServer(options: SilkweaveOptions, actions: Action[], context: SilkweaveContext, onToolCall?: OnToolCall): McpServer {
  const server = new McpServer({
    name: options.name,
    description: options.description,
    version: options.version
  }, {
    capabilities: { tools: {}, logging: {} }
  })
  registerTools(server, actions, context, { onToolCall })
  return server
}

export interface McpTransportHandlers {
  /** `POST /mcp` - handle a single stateless MCP request/response (SSE per call). */
  post: RequestHandler
}

export interface McpTransportOptions {
  /**
   * Per-request tool filter, applied before `registerTools()` on every POST.
   * See `FilterActions` for the request stand-in and error semantics.
   */
  filterActions?: FilterActions
  /** Telemetry hook invoked once per tool call (fire-and-forget). */
  onToolCall?: OnToolCall
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
  actions: Action[],
  options: McpTransportOptions = {}
): McpTransportHandlers {
  // Fail at boot, not per request - the factory runs once when the app is built.
  actions.forEach(validateActionDisposition)

  const post: RequestHandler = async (req, res) => {
    let active = actions
    if (options.filterActions) {
      try {
        active = await options.filterActions(actions, { headers: req.headers, url: req.originalUrl ?? req.url, ...rpcInfo(req.body) })
      } catch (error) {
        // A throw never degrades to an empty tool list - it surfaces as its
        // statusCode (SilkweaveError) or a 500, so a bad key reads as an auth
        // failure rather than "server has no tools".
        const { status, body } = filterErrorResponse(error, req.body)
        res.status(status).json(body)
        return
      }
    }
    try {
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined })
      const server = createMcpServer(silkweaveOptions, active, context, options.onToolCall)
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
