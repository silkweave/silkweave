import { toNodeHandler } from '@modelcontextprotocol/node'
import { createMcpHandler } from '@modelcontextprotocol/server'
import {
  Action,
  OnToolCall,
  SilkweaveContext,
  SilkweaveOptions,
  Skill,
  SkillDefinition,
  assertZodV4Schemas,
  validateActionDisposition
} from '@silkweave/core'
import { type RequestHandler } from 'express'
import { authFromRequest } from './auth.js'
import { filterErrorResponse, rpcInfo, type FilterActions } from './filter.js'
import { createMcpServer } from './mcpServer.js'
import { emitInvalidArguments } from './prevalidate.js'
import { prepareSkills, type SkillServing, type SkillsMarketplaceOptions } from './skills.js'

export interface McpTransportHandlers {
  /** `POST /mcp` - handle a single stateless MCP request/response (SSE per call). */
  post: RequestHandler
  /**
   * `GET`/`DELETE` on the transport path. The stateless transport is POST-only:
   * there is no standing SSE stream to open and no session to tear down.
   * Streamable HTTP requires a server offering no stream to answer `GET` with
   * 405, and MCP clients treat 405 as the "no stream here" signal - mounted
   * under a framework's default 404 they instead see an error naming neither
   * the method nor the route. Wire this for GET and DELETE alongside `post`.
   */
  methodNotAllowed: RequestHandler
  /**
   * Resolves when the async parts of the handler (the `skills` option) are
   * ready; rejects on a skill boot failure. Server-owning callers (`http()`)
   * await this so a bad skill fails `start()` instead of every request.
   */
  ready: Promise<void>
  /**
   * The resolved skill-serving surface (undefined without a `skills` option).
   * `buildMcpExpressApp` reads `marketplace` off it for the
   * `/.claude-plugin/marketplace.json` route.
   */
  skills: Promise<SkillServing | undefined>
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
   * Also serve 2025-era MCP clients (the `initialize` handshake) through the
   * SDK's stateless legacy path. Off by default: Silkweave speaks protocol
   * 2026-07-28 only, and a 2025-only client gets the SDK's
   * unsupported-protocol-version error. Enable it for hosts that have not
   * moved to 2026-07-28 yet (older Claude Code versions, v1 SDK clients).
   */
  legacy?: boolean
  /**
   * Agent skills to serve: `skill://` file resources + `ListSkills`/`GetSkill`
   * tools + a server-instructions pointer. Requires `@silkweave/skills`
   * (optional peer); resolved once, reused across per-request servers.
   */
  skills?: (Skill | SkillDefinition)[]
  /** EXPERIMENTAL: also serve the SEP-2640 draft extension (`skills/list`/`skills/get` + capability). */
  skillsExtension?: boolean
  /**
   * Serve a Claude Code plugin marketplace at `/.claude-plugin/marketplace.json`
   * listing the served skills that carry an `npmPackage`. Requires `skills`.
   */
  skillsMarketplace?: SkillsMarketplaceOptions
}

/**
 * Build the MCP Streamable HTTP transport route handler.
 *
 * Stateless: each `POST /mcp` builds a fresh server (via the MCP SDK v2
 * `createMcpHandler`) for exactly that request, streaming progress over SSE
 * when the call carries a `progressToken`. Speaks protocol 2026-07-28 (incl.
 * `server/discover`); 2025-era clients only with the `legacy` opt-in. No `Mcp-Session-Id`, no session map, no
 * `GET`/`DELETE` reconnect - any request can hit any instance.
 */
export function mcpTransport(
  silkweaveOptions: SilkweaveOptions,
  context: SilkweaveContext,
  actions: Action[],
  options: McpTransportOptions = {}
): McpTransportHandlers {
  // Fail at boot, not per request - the factory runs once when the app is built.
  actions.forEach(assertZodV4Schemas)
  actions.forEach(validateActionDisposition)
  // Resolved once; a rejection is surfaced through `ready` (and re-thrown per
  // request), never left as an unhandled rejection.
  const skillsReady = prepareSkills(options.skills, {
    extension: options.skillsExtension,
    ...(options.skillsMarketplace
      ? { marketplace: { ...options.skillsMarketplace, name: options.skillsMarketplace.name ?? silkweaveOptions.name } }
      : {})
  })
  skillsReady.catch(() => {
    /* surfaced via `ready` / per-request await */
  })

  const post: RequestHandler = async (req, res) => {
    // JSON-RPC batching was removed from the MCP spec (2025-06-18). A batch also
    // defeats per-request filterActions: rpcInfo reflects only the first message
    // but the SDK transport would execute every entry, so a later batch entry
    // could invoke a tool the filter gated on the first. Reject batches outright.
    if (Array.isArray(req.body)) {
      res.status(400).json({
        jsonrpc: '2.0',
        error: { code: -32_600, message: 'JSON-RPC batch requests are not supported' },
        id: null
      })
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
        active = await options.filterActions(combined, {
          headers: req.headers,
          url: req.originalUrl ?? req.url,
          ...rpcInfo(req.body)
        })
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
      // Fork the caller's resolved auth (attached by authMiddleware) into the
      // per-request context; registerTools' tool-call fork inherits it.
      const auth = authFromRequest(req)
      const reqContext = auth ? context.fork({ auth }) : context
      // Emit-only: the SDK rejects an invalid-arguments tools/call before the
      // handler (and its telemetry emit) ever runs, so surface it here. The
      // request still proceeds to the SDK for its native rejection.
      await emitInvalidArguments(req.body, active, reqContext, options.onToolCall)
      // A per-request handler whose factory closes over this request's filtered
      // actions + forked context. Protocol 2026-07-28 (incl. `server/discover`);
      // 2025-era traffic only with the `legacy` opt-in (the SDK's stateless leg).
      const handler = createMcpHandler(
        () => createMcpServer(silkweaveOptions, active, reqContext, options.onToolCall, serving),
        {
          legacy: options.legacy ? 'stateless' : 'reject',
          onerror: (error) => console.error('MCP handler error:', error)
        }
      )
      await toNodeHandler(handler)(req, res, req.body)
    } catch (error) {
      console.error('Error handling MCP request:', error)
      if (!res.headersSent) {
        res.status(500).json({ jsonrpc: '2.0', error: { code: -32_603, message: 'Internal server error' }, id: null })
      }
    }
  }

  const methodNotAllowed: RequestHandler = (_req, res) => {
    res
      .set('Allow', 'POST')
      .status(405)
      .json({
        jsonrpc: '2.0',
        error: { code: -32_000, message: 'Method Not Allowed: this MCP endpoint is POST-only' },
        id: null
      })
  }

  return { post, methodNotAllowed, ready: skillsReady.then(() => undefined), skills: skillsReady }
}
