import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { Action, OnToolCall, SilkweaveContext, SilkweaveOptions, Skill, SkillDefinition, validateActionDisposition } from '@silkweave/core'
import { type RequestHandler } from 'express'
import { authFromRequest } from './auth.js'
import { filterErrorResponse, rpcInfo, type FilterActions } from './filter.js'
import { emitInvalidArguments } from './prevalidate.js'
import { registerTools } from './registerTools.js'
import { prepareSkills, type SkillServing } from './skills.js'

function createMcpServer(
  options: SilkweaveOptions,
  actions: Action[],
  context: SilkweaveContext,
  onToolCall?: OnToolCall,
  serving?: SkillServing
): McpServer {
  // Gate the whole skill surface (resources + instructions) on the skill
  // actions having survived the per-request filter - see SkillServing.visible.
  const skillsVisible = serving?.visible(actions) ?? false
  const server = new McpServer({
    name: options.name,
    description: options.description,
    version: options.version
  }, {
    capabilities: { tools: {}, logging: {}, ...(skillsVisible ? { resources: {} } : {}) },
    ...(skillsVisible && serving ? { instructions: serving.instructions } : {})
  })
  registerTools(server, actions, context, { onToolCall })
  if (skillsVisible) { serving?.register(server) }
  return server
}

export interface McpTransportHandlers {
  /** `POST /mcp` - handle a single stateless MCP request/response (SSE per call). */
  post: RequestHandler
  /**
   * Resolves when the async parts of the handler (the `skills` option) are
   * ready; rejects on a skill boot failure. Server-owning callers (`http()`)
   * await this so a bad skill fails `start()` instead of every request.
   */
  ready: Promise<void>
}

export interface McpTransportOptions {
  /**
   * Per-request tool filter, applied before `registerTools()` on every POST.
   * See `FilterActions` for the request stand-in and error semantics.
   */
  filterActions?: FilterActions
  /** Telemetry hook invoked once per tool call (fire-and-forget). */
  onToolCall?: OnToolCall
  /**
   * Agent skills to serve: `skill://` file resources + `ListSkills`/`GetSkill`
   * tools + a server-instructions pointer. Requires `@silkweave/skills`
   * (optional peer); resolved once, reused across per-request servers.
   */
  skills?: (Skill | SkillDefinition)[]
  /** EXPERIMENTAL: also serve the SEP-2640 draft extension (`skills/list`/`skills/get` + capability). */
  skillsExtension?: boolean
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
  // Resolved once; a rejection is surfaced through `ready` (and re-thrown per
  // request), never left as an unhandled rejection.
  const skillsReady = prepareSkills(options.skills, { extension: options.skillsExtension })
  skillsReady.catch(() => { /* surfaced via `ready` / per-request await */ })

  const post: RequestHandler = async (req, res) => {
    // JSON-RPC batching was removed from the MCP spec (2025-06-18). A batch also
    // defeats per-request filterActions: rpcInfo reflects only the first message
    // but the SDK transport would execute every entry, so a later batch entry
    // could invoke a tool the filter gated on the first. Reject batches outright.
    if (Array.isArray(req.body)) {
      res.status(400).json({ jsonrpc: '2.0', error: { code: -32_600, message: 'JSON-RPC batch requests are not supported' }, id: null })
      return
    }
    let serving: SkillServing | undefined
    try {
      serving = await skillsReady
    } catch (error) {
      console.error('Error resolving skills:', error)
      res.status(500).json({ jsonrpc: '2.0', error: { code: -32_603, message: 'Internal server error' }, id: null })
      return
    }
    const combined = serving ? [...actions, ...serving.actions] : actions
    let active = combined
    if (options.filterActions) {
      try {
        active = await options.filterActions(combined, { headers: req.headers, url: req.originalUrl ?? req.url, ...rpcInfo(req.body) })
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
      // Fork the caller's resolved auth (attached by authMiddleware) into the
      // per-request context; registerTools' tool-call fork inherits it.
      const auth = authFromRequest(req)
      const reqContext = auth ? context.fork({ auth }) : context
      // Emit-only: the SDK rejects an invalid-arguments tools/call before the
      // handler (and its telemetry emit) ever runs, so surface it here. The
      // request still proceeds to the SDK for its native rejection.
      await emitInvalidArguments(req.body, active, reqContext, options.onToolCall)
      const server = createMcpServer(silkweaveOptions, active, reqContext, options.onToolCall, serving)
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

  return { post, ready: skillsReady.then(() => undefined) }
}
