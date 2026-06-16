import { InMemoryEventStore } from '@modelcontextprotocol/sdk/examples/shared/inMemoryEventStore.js'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js'
import { Action, ActionRun, isStreamingAction, runStreamingAction, SilkweaveContext, SilkweaveOptions } from '@silkweave/core'
import { createLogger } from '@silkweave/logger'
import { capitalCase, pascalCase } from 'change-case'
import { randomUUID } from 'crypto'
import { type RequestHandler } from 'express'
import { handleToolError, jsonToolResult, smartToolResult } from '../util/result.js'
import { authStorage } from './auth.js'

/**
 * Build the generic `request` context value (the same key REST/tRPC populate)
 * from the MCP SDK's `extra.requestInfo`, so transport-agnostic consumers - e.g.
 * `@silkweave/nestjs` `@UseGuards` guards reading
 * `switchToHttp().getRequest().headers` - work over MCP. There is no path
 * `params`/`query` on an MCP call, so those are empty stand-ins for graceful
 * degradation. Returns `undefined` when no HTTP request info is available.
 */
function requestFromExtra(requestInfo: { headers?: unknown; url?: { toString(): string } } | undefined) {
  if (!requestInfo) { return undefined }
  return { headers: requestInfo.headers ?? {}, url: requestInfo.url?.toString(), params: {}, query: {} }
}

function registerTools(server: McpServer, actions: Action[], context: SilkweaveContext) {
  for (const action of actions) {
    server.registerTool(pascalCase(action.name), {
      title: capitalCase(action.name),
      description: action.description,
      inputSchema: action.input
    }, async (input, extra) => {
      const logger = createLogger({
        stream: process.stderr,
        onLog: (level, data) => {
          extra.sendNotification({ method: 'notifications/message', params: { level, data } })
        },
        onProgress: ({ progress, total, message }) => {
          if (!extra._meta?.progressToken) { return }
          extra.sendNotification({
            method: 'notifications/progress',
            params: { progress, total, message, progressToken: extra._meta.progressToken }
          })
        }
      })
      const currentAuth = authStorage.getStore()
      const actionContext = context.fork({
        logger,
        extra,
        request: requestFromExtra(extra.requestInfo),
        ...(currentAuth ? { auth: currentAuth } : {})
      })
      // Client-sent `_meta.disposition` wins; otherwise fall back to the
      // action's configured default (`smart` when neither is set).
      const disposition = extra._meta?.disposition ?? action.disposition
      const progressToken = extra._meta?.progressToken
      try {
        let result: object | object[]
        if (isStreamingAction(action)) {
          result = await runStreamingAction(action, input, actionContext, progressToken
            ? async (chunk, index) => {
              await extra.sendNotification({
                method: 'notifications/progress',
                params: { progressToken, progress: index + 1, message: JSON.stringify(chunk) }
              })
            }
            : undefined)
        } else {
          result = await (action.run as ActionRun<object, object>)(input, actionContext)
        }
        if (action.toolResult) {
          const response = action.toolResult(result, actionContext)
          if (response) { return response }
        }
        return disposition === 'json' ? jsonToolResult(result) : smartToolResult(result)
      } catch (error) {
        return handleToolError(error)
      }
    })
  }
}

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

function createSessionTransport(transports: Record<string, StreamableHTTPServerTransport>): StreamableHTTPServerTransport {
  const eventStore = new InMemoryEventStore()
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
    enableJsonResponse: false,
    eventStore,
    onsessioninitialized: (sId) => {
      transports[sId] = transport
    }
  })
  transport.onerror = (error) => { console.error(error) }
  transport.onclose = () => {
    const sid = transport.sessionId
    if (sid && transports[sid]) { delete transports[sid] }
  }
  return transport
}

export interface McpTransportHandlers {
  /** `POST /mcp` - initialize session or dispatch request to an existing one. */
  post: RequestHandler
  /** `GET /mcp` and `DELETE /mcp` - long-poll session stream / session termination. Also covers `GET /mcp/resource/:id`. */
  stream: RequestHandler
}

/**
 * Build the MCP Streamable HTTP transport route handlers.
 *
 * Sessions are kept in a per-call closure (one map per `mcpTransport()` call),
 * so the same handler object should be registered for all three transport
 * routes - `POST /mcp`, `GET /mcp`, `DELETE /mcp` - to share session state.
 */
export function mcpTransport(
  silkweaveOptions: SilkweaveOptions,
  context: SilkweaveContext,
  actions: Action[]
): McpTransportHandlers {
  const transports: Record<string, StreamableHTTPServerTransport> = {}

  const post: RequestHandler = async (req, res) => {
    const sessionId = req.headers['mcp-session-id'] as string | undefined
    try {
      if (sessionId && transports[sessionId]) {
        await transports[sessionId].handleRequest(req, res, req.body)
        return
      }
      if (!isInitializeRequest(req.body)) {
        res.status(404).json({ jsonrpc: '2.0', error: { code: -32_000, message: 'Session not found' }, id: null })
        return
      }
      const transport = createSessionTransport(transports)
      await createMcpServer(silkweaveOptions, actions, context).connect(transport)
      await transport.handleRequest(req, res, req.body)
    } catch (error) {
      console.error('Error handling MCP request:', error)
      if (!res.headersSent) {
        res.status(500).json({ jsonrpc: '2.0', error: { code: -32_603, message: 'Internal server error' }, id: null })
      }
    }
  }

  const stream: RequestHandler = async (req, res) => {
    const sessionId = req.headers['mcp-session-id'] as string | undefined
    if (!sessionId || !transports[sessionId]) {
      res.status(400).send('Invalid or missing session ID')
      return
    }
    await transports[sessionId].handleRequest(req, res)
  }

  return { post, stream }
}
