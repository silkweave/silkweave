import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { RequestHandlerExtra } from '@modelcontextprotocol/sdk/shared/protocol.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { ServerNotification, ServerRequest } from '@modelcontextprotocol/sdk/types.js'
import {
  Action,
  ActionRun,
  binarySchemaMeta,
  createLogger,
  emitToolCall,
  isStreamingAction,
  OnToolCall,
  resourceBytes,
  runStreamingAction,
  SilkweaveContext,
  SilkweaveError,
  toActionResource,
  ToolCallEvent,
  type ActionResource
} from '@silkweave/core'
import { capitalCase, pascalCase } from 'change-case'
import {
  errorToolResult,
  handleToolError,
  jsonToolResult,
  resourceToolResult,
  smartToolResult,
  structuredToolResult
} from '../util/result.js'

type LogStream = NonNullable<Parameters<typeof createLogger>[0]>['stream']
type ToolExtra = RequestHandlerExtra<ServerRequest, ServerNotification>

export interface RegisterToolsOptions {
  /**
   * Where the per-call logger writes its human-readable stream. The `stdio`
   * adapter MUST pass `false` (stdout is the MCP protocol channel); the HTTP
   * transports default to `process.stderr`.
   */
  logStream?: LogStream
  /**
   * Telemetry hook invoked once per tool call (fire-and-forget; errors are
   * logged, never propagated). Fires after result formatting, so events carry
   * `resultBytes` (serialized raw-result size) and `sideloaded` (whether
   * `smartToolResult` offloaded to an embedded resource).
   */
  onToolCall?: OnToolCall
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
  if (!requestInfo) {
    return undefined
  }
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
      if (!extra._meta?.progressToken) {
        return
      }
      extra.sendNotification({
        method: 'notifications/progress',
        params: { progress, total, message, progressToken: extra._meta.progressToken }
      })
    }
  })
}

/** Run the action, streaming chunks as progress notifications when a token is set. */
async function runAction(
  action: Action,
  input: object,
  context: SilkweaveContext,
  extra: ToolExtra
): Promise<object | object[]> {
  const progressToken = extra._meta?.progressToken
  if (isStreamingAction(action)) {
    return runStreamingAction(
      action,
      input,
      context,
      progressToken
        ? async (chunk, index) => {
            await extra.sendNotification({
              method: 'notifications/progress',
              params: { progressToken, progress: index + 1, message: JSON.stringify(chunk) }
            })
          }
        : undefined
    )
  }
  return (action.run as ActionRun<object, object>)(input, context)
}

/**
 * Result path for a `disposition: 'structured'` action: parse the raw result
 * through the output schema and ship the PARSED data as `structuredContent`.
 * Parsing strips extra fields (so the client-side JSON-Schema validator, which
 * rejects `additionalProperties`, passes by construction) and a genuine
 * mismatch (missing required field, wrong type) degrades to an `isError` tool
 * result - which the SDK exempts from output validation - instead of an opaque
 * protocol error.
 */
function structuredResult(action: Action, result: object | object[]) {
  const parsed = action.output!.safeParse(result)
  if (!parsed.success) {
    const fields = [...new Set(parsed.error.issues.map((issue) => issue.path.join('.') || '(root)'))].join(', ')
    return errorToolResult(
      new SilkweaveError(
        `Output validation failed for '${action.name}' at: ${fields}. The tool returned a shape that does not match its declared output schema - this is a server-side bug, not an input problem; retrying with different arguments will not help.`,
        'output_validation_error'
      )
    )
  }
  // The SDK independently re-parses `structuredContent` against the same schema.
  // A non-idempotent output schema (a field-level `.transform()`) yields data
  // that fails that second parse, which the SDK raises as an opaque protocol
  // error. Detect it here and degrade to a clear isError result (SDK-exempt)
  // instead - structured contracts must be idempotent (no transforms).
  if (!action.output!.safeParse(parsed.data).success) {
    return errorToolResult(
      new SilkweaveError(
        `Output schema for '${action.name}' is not idempotent (a field-level .transform()?) and cannot back a 'structured' contract - use disposition 'json' or remove the transform.`,
        'output_schema_not_structurable'
      )
    )
  }
  return structuredToolResult(parsed.data as object)
}

/** MCP-only telemetry fields, computed only when a hook is registered. */
function resultMeta(
  result: object | object[],
  formatted: { content?: { type: string }[] },
  res?: ActionResource
): Pick<ToolCallEvent, 'resultBytes' | 'sideloaded'> {
  return {
    // Actual UTF-8 byte count (String.length counts UTF-16 code units, which
    // understates multibyte payloads). TextEncoder keeps this edge-safe. A
    // resource result's size is its payload, not a JSON stringification of it.
    resultBytes: res ? resourceBytes(res).length : new TextEncoder().encode(JSON.stringify(result)).length,
    // `sideloaded` means smart-disposition offload; a deliberate resource
    // result rendering as an embedded-resource block is not an offload.
    sideloaded: !res && (formatted.content ?? []).some((block) => block.type === 'resource')
  }
}

/** Error identity for telemetry: a SilkweaveError's `code`, else the error's name. */
function errorMeta(error: unknown): Pick<ToolCallEvent, 'errorCode' | 'errorMessage'> {
  if (error instanceof SilkweaveError) {
    return { errorCode: error.code, errorMessage: error.message }
  }
  if (error instanceof Error) {
    return { errorCode: error.name, errorMessage: error.message }
  }
  return { errorCode: 'unknown' }
}

/** Format via the action's `toolResult` hook, else resource mapping, else the resolved disposition. */
function formatToolResult(
  action: Action,
  result: object | object[],
  context: SilkweaveContext,
  disposition: unknown,
  res: ActionResource | undefined
) {
  if (action.toolResult) {
    // core's dependency-free ToolResult is structurally the SDK CallToolResult;
    // narrow it back at the SDK boundary.
    const response = action.toolResult(result, context) as CallToolResult | undefined
    if (response) {
      return response
    }
  }
  // A structured action's output schema is a contract fixed at tools/list
  // time - a client's `_meta.disposition` cannot demote it.
  if (action.disposition === 'structured') {
    return structuredResult(action, result)
  }
  // A resource result (resource()/File/Blob/bytes) has its own mime-driven
  // mapping; `_meta.disposition` has nothing to demote it to - json/smart
  // would stringify bytes into garbage - so it always wins over both.
  if (res) {
    return resourceToolResult(res)
  }
  return disposition === 'smart' ? smartToolResult(result) : jsonToolResult(result)
}

/**
 * Register every action as an MCP tool on `server`. Shared by all MCP transports
 * (`stdio`, `http`, `edge`). Each tool call forks `context` with a per-call
 * `logger`, the SDK `extra`, a synthesized `request` (see `requestFromExtra`),
 * and - when bearer auth ran for this request - the resolved `auth`. The result
 * is formatted by the action's `toolResult` hook if present, otherwise per the
 * resolved disposition (client `_meta.disposition` > `action.disposition` >
 * `json`); a `'structured'` action always ships schema-parsed
 * `structuredContent` (its contract cannot be demoted per-call).
 */
export function registerTools(
  server: McpServer,
  actions: Action[],
  context: SilkweaveContext,
  options: RegisterToolsOptions = {}
) {
  const stream = options.logStream ?? process.stderr
  for (const action of actions) {
    server.registerTool(
      pascalCase(action.name),
      {
        title: capitalCase(action.name),
        description: action.description,
        inputSchema: action.input,
        // Derived base (query ⇒ read-only), explicit annotations merged over.
        annotations: { readOnlyHint: action.kind === 'query', ...action.annotations },
        // Only structured actions declare an outputSchema contract - the SDK
        // enforces it server-side and SDK clients enforce it independently, so
        // forwarding is strictly opt-in via disposition.
        ...(action.disposition === 'structured' && action.output ? { outputSchema: action.output } : {}),
        // Positional-argument intent for silkweave-aware CLI clients (cliProxy
        // renders these input fields as positional arguments, in order).
        // Spec-legal tool _meta, ignored by every other client.
        ...(action.args?.length ? { _meta: { 'silkweave/args': action.args } } : {})
      },
      async (input, extra) => {
        const logger = createToolLogger(extra, stream)
        // `auth` (when present) is carried on `context` by the transport's
        // per-request fork; this fork inherits it - no AsyncLocalStorage needed.
        const actionContext = context.fork({
          logger,
          extra,
          request: requestFromExtra(extra.requestInfo)
        })
        // Client-sent `_meta.disposition` wins; otherwise fall back to the
        // action's configured default (`json` when neither is set).
        const disposition = extra._meta?.disposition ?? action.disposition
        // `input` is the SDK-parsed (post-zod) input - defaults applied, unknown
        // keys stripped - so telemetry `args` matches what the action ran with.
        const base = {
          action: action.name,
          tool: pascalCase(action.name),
          transport: 'mcp' as const,
          args: input as unknown,
          context: actionContext
        }
        const started = Date.now()
        try {
          const result = await runAction(action, input, actionContext, extra)
          const res = await toActionResource(result, binarySchemaMeta(action.output))
          const formatted = formatToolResult(action, result, actionContext, disposition, res)
          emitToolCall(options.onToolCall, {
            ...base,
            durationMs: Date.now() - started,
            ok: formatted.isError !== true,
            ...(options.onToolCall ? resultMeta(result, formatted, res) : {})
          })
          return formatted
        } catch (error) {
          emitToolCall(options.onToolCall, {
            ...base,
            durationMs: Date.now() - started,
            ok: false,
            ...errorMeta(error)
          })
          return handleToolError(error)
        }
      }
    )
  }
}
