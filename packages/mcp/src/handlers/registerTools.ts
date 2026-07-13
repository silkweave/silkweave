import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { RequestHandlerExtra } from '@modelcontextprotocol/sdk/shared/protocol.js'
import type { ServerNotification, ServerRequest } from '@modelcontextprotocol/sdk/types.js'
import { Action, ActionRun, createLogger, isStreamingAction, runStreamingAction, SilkweaveContext } from '@silkweave/core'
import { capitalCase, pascalCase } from 'change-case'
import { handleToolError, jsonToolResult, smartToolResult } from '../util/result.js'
import { authStorage } from './auth.js'

type LogStream = NonNullable<Parameters<typeof createLogger>[0]>['stream']
type ToolExtra = RequestHandlerExtra<ServerRequest, ServerNotification>

export interface RegisterToolsOptions {
  /**
   * Where the per-call logger writes its human-readable stream. The `stdio`
   * adapter MUST pass `false` (stdout is the MCP protocol channel); the HTTP
   * transports default to `process.stderr`.
   */
  logStream?: LogStream
}

/**
 * Build the generic `request` context value (the same key REST/tRPC populate)
 * from the MCP SDK's `extra.requestInfo`, so transport-agnostic consumers - e.g.
 * `@silkweave/nestjs` `@UseGuards` guards reading
 * `switchToHttp().getRequest().headers` - work over MCP. There are no path
 * `params`/`query`/`body` on the raw MCP call, so those start as empty
 * stand-ins; `@silkweave/nestjs` later fills them from the validated tool input
 * per the reflected param sources (path -> `params`, `@Query` -> `query`,
 * `@Body` -> `body`) so guards reading any of them decide as they would over
 * REST. Returns `undefined` when no HTTP request info is available.
 */
export function requestFromExtra(requestInfo: { headers?: unknown; url?: { toString(): string } } | undefined) {
  if (!requestInfo) { return undefined }
  return { headers: requestInfo.headers ?? {}, url: requestInfo.url?.toString(), params: {}, query: {}, body: {} }
}

/** Per-call logger that bridges silkweave logs/progress onto MCP notifications. */
function createToolLogger(extra: ToolExtra, stream: LogStream) {
  return createLogger({
    stream,
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
}

/** Run the action, streaming chunks as progress notifications when a token is set. */
async function runAction(action: Action, input: object, context: SilkweaveContext, extra: ToolExtra): Promise<object | object[]> {
  const progressToken = extra._meta?.progressToken
  if (isStreamingAction(action)) {
    return runStreamingAction(action, input, context, progressToken
      ? async (chunk, index) => {
        await extra.sendNotification({
          method: 'notifications/progress',
          params: { progressToken, progress: index + 1, message: JSON.stringify(chunk) }
        })
      }
      : undefined)
  }
  return (action.run as ActionRun<object, object>)(input, context)
}

/** Format via the action's `toolResult` hook, else the resolved disposition. */
function formatToolResult(action: Action, result: object | object[], context: SilkweaveContext, disposition: unknown) {
  if (action.toolResult) {
    const response = action.toolResult(result, context)
    if (response) { return response }
  }
  return disposition === 'json' ? jsonToolResult(result) : smartToolResult(result)
}

/**
 * Register every action as an MCP tool on `server`. Shared by all MCP transports
 * (`stdio`, `http`, `edge`). Each tool call forks `context` with a per-call
 * `logger`, the SDK `extra`, a synthesized `request` (see `requestFromExtra`),
 * and - when bearer auth ran for this request - the resolved `auth`. The result
 * is formatted by the action's `toolResult` hook if present, otherwise per the
 * resolved disposition (client `_meta.disposition` > `action.disposition` >
 * `smart`).
 */
export function registerTools(
  server: McpServer,
  actions: Action[],
  context: SilkweaveContext,
  options: RegisterToolsOptions = {}
) {
  const stream = options.logStream ?? process.stderr
  for (const action of actions) {
    server.registerTool(pascalCase(action.name), {
      title: capitalCase(action.name),
      description: action.description,
      inputSchema: action.input,
      // Derived base (query ⇒ read-only), explicit annotations merged over.
      annotations: { readOnlyHint: action.kind === 'query', ...action.annotations }
    }, async (input, extra) => {
      const logger = createToolLogger(extra, stream)
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
      try {
        const result = await runAction(action, input, actionContext, extra)
        return formatToolResult(action, result, actionContext, disposition)
      } catch (error) {
        return handleToolError(error)
      }
    })
  }
}
