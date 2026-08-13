import { Action, emitToolCall, OnToolCall, SilkweaveContext } from '@silkweave/core'
import { pascalCase } from 'change-case'

/**
 * Emit-only pre-validation for the stateless MCP HTTP transports (`http()` /
 * `edge()`): when the POSTed message is a `tools/call` whose arguments fail
 * the matched action's input schema, emit an `ok: false` telemetry event with
 * the stable `errorCode: 'INVALID_ARGUMENTS'` and `args` set to the raw
 * offered input. The SDK validates the same schema before the tool handler
 * runs and rejects the call without ever reaching the handler's emit path -
 * this seam is the only way such calls become visible to `onToolCall`.
 *
 * Strictly emit-only: the request always proceeds to the SDK, which produces
 * its own native rejection (an `isError` tool result carrying the
 * `InvalidParams` message on SDK 1.29), so wire behavior is identical with or
 * without a hook and the seam survives an SDK major swap unchanged. Validation mirrors the SDK exactly - the same
 * schema, `safeParseAsync` on the verbatim `params.arguments` - so a call can
 * never emit both a failure event here and a success event from the handler.
 * An unknown tool name is skipped (the SDK's "tool not found" rejection is
 * not an arguments failure), and any unexpected internal throw is logged and
 * swallowed - telemetry can never fail the call path.
 */
export async function emitInvalidArguments(
  body: unknown,
  actions: Action[],
  context: SilkweaveContext,
  onToolCall: OnToolCall | undefined
): Promise<void> {
  if (!onToolCall) {
    return
  }
  try {
    const message = body as { method?: unknown; params?: { name?: unknown; arguments?: unknown } } | undefined
    if (message?.method !== 'tools/call' || typeof message.params?.name !== 'string') {
      return
    }
    const tool = message.params.name
    const action = actions.find((candidate) => pascalCase(candidate.name) === tool)
    if (!action) {
      return
    }
    const parsed = await action.input.safeParseAsync(message.params.arguments)
    if (parsed.success) {
      return
    }
    const details = parsed.error.issues
      .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('; ')
    emitToolCall(onToolCall, {
      action: action.name,
      tool,
      transport: 'mcp',
      durationMs: 0,
      ok: false,
      errorCode: 'INVALID_ARGUMENTS',
      errorMessage: `Invalid arguments for tool ${tool}: ${details}`,
      args: message.params.arguments,
      context
    })
  } catch (error) {
    console.error('emitInvalidArguments error:', error)
  }
}
