import { SilkweaveContext } from './context.js'

/**
 * One tool/procedure invocation, as reported to an `OnToolCall` hook. MCP
 * adapters emit these from the tool registrar (where result formatting
 * happens, so `resultBytes`/`sideloaded` are known); other transports emit
 * from their own invocation seam and omit the MCP-only fields.
 */
export interface ToolCallEvent {
  /** Action name (e.g. `'leads.bulkUpdate'`). */
  action: string
  /** Wire name the client called (e.g. `'LeadsBulkUpdate'` over MCP, `'leadsBulkUpdate'` over tRPC). */
  tool: string
  transport: 'mcp' | 'trpc' | 'rest' | 'cli'
  /** Wall-clock duration; for streaming actions this spans full generator consumption. */
  durationMs: number
  /**
   * `false` when the action threw or the formatted result is an MCP
   * `isError` tool result. `errorCode`/`errorMessage` are set for thrown
   * errors (a `SilkweaveError`'s `code`, else the error's `name`).
   */
  ok: boolean
  errorCode?: string
  errorMessage?: string
  /** Serialized (JSON) size of the raw result - MCP-layer events only. */
  resultBytes?: number
  /** Whether `smartToolResult` offloaded the payload to an embedded resource - MCP-layer events only. */
  sideloaded?: boolean
  /** The per-call action context (access to `auth`/`request` for spaceId, apiKeyId, ...). */
  context: SilkweaveContext
}

/**
 * Telemetry hook invoked once per tool call, fire-and-forget: adapters never
 * await it on the result path and swallow (log) its errors, so the hook can
 * never fail, slow, or reorder a call.
 */
export type OnToolCall = (event: ToolCallEvent) => void | Promise<void>

/**
 * Invoke an `OnToolCall` hook with fire-and-forget semantics - sync throws and
 * async rejections are logged to stderr and never propagate to the call path.
 */
export function emitToolCall(hook: OnToolCall | undefined, event: ToolCallEvent): void {
  if (!hook) { return }
  try {
    void Promise.resolve(hook(event)).catch((error: unknown) => { console.error('onToolCall hook error:', error) })
  } catch (error) {
    console.error('onToolCall hook error:', error)
  }
}
