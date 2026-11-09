import { SilkweaveContext } from './context.js'
import { SilkweaveError } from './error.js'

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
   *
   * Input-validation failures also emit an event (the handler never runs):
   * `ok: false` with the stable `errorCode: 'INVALID_ARGUMENTS'`, `args` set
   * to the raw offered input, and `durationMs: 0`. Emitted by the stateless
   * MCP HTTP transports (`http()`/`edge()`; `stdio` is not covered) and the
   * `@silkweave/nestjs` tRPC adapter. These are cheap for a client to trigger
   * at high rate - batch/sample in the hook rather than writing per event.
   */
  ok: boolean
  errorCode?: string
  errorMessage?: string
  /**
   * HTTP-equivalent status of a failed call, so consumers can grade severity
   * without mapping `errorCode`s themselves: a `SilkweaveError`'s `statusCode`,
   * else a thrown error's own HTTP status (`getStatus()` - NestJS
   * `HttpException` - or a numeric 4xx/5xx `statusCode`/`status` property),
   * `400` for `INVALID_ARGUMENTS`, `500` for any other thrown error. Unset on
   * success and on an `isError` result produced without a throw (e.g. by a
   * `toolResult` hook or an output-schema mismatch).
   */
  statusCode?: number
  /**
   * Who caused the failure: `'client'` when `statusCode < 500` (bad input,
   * not found, forbidden, unauthorized - log at warning), `'server'`
   * otherwise (a defect - log at error). Unset whenever `statusCode` is unset;
   * treat an unset `fault` on a failed call as `'server'`.
   */
  fault?: ToolCallFault
  /**
   * The call's input. On success (and handler-thrown-error) events this is the
   * parsed (post-zod) input the action ran with - defaults applied, unknown
   * keys stripped. On `INVALID_ARGUMENTS` events it is the raw offered input
   * exactly as the client sent it (attacker-controlled, may be any shape or
   * `undefined`). UNREDACTED either way - like `context` (which already
   * carries the raw request incl. `Authorization` headers), consumers must
   * redact/truncate before persisting.
   */
  args?: unknown
  /** Serialized (JSON) size of the raw result - MCP-layer events only. */
  resultBytes?: number
  /** Whether `smartToolResult` offloaded the payload to an embedded resource - MCP-layer events only. */
  sideloaded?: boolean
  /** The per-call action context (access to `auth`/`request` for spaceId, apiKeyId, ...). */
  context: SilkweaveContext
}

/** Failure attribution on a `ToolCallEvent`: caller error (4xx) vs server fault (5xx). */
export type ToolCallFault = 'client' | 'server'

/** Map an HTTP-equivalent status to its fault class (`< 500` ⇒ client). */
export function faultForStatus(statusCode: number): ToolCallFault {
  return statusCode < 500 ? 'client' : 'server'
}

/** Read a thrown value's HTTP status, if it carries a plausible (400-599) one. */
function thrownStatus(error: unknown): number | undefined {
  if (error instanceof SilkweaveError) {
    return error.statusCode
  }
  if (typeof error !== 'object' || error === null) {
    return undefined
  }
  const candidate = error as { getStatus?: unknown; statusCode?: unknown; status?: unknown }
  const raw =
    typeof candidate.getStatus === 'function'
      ? (candidate.getStatus as () => unknown)()
      : (candidate.statusCode ?? candidate.status)
  return typeof raw === 'number' && Number.isInteger(raw) && raw >= 400 && raw <= 599 ? raw : undefined
}

/**
 * Error fields for a `ToolCallEvent` from a thrown value - the one mapping
 * every adapter emit site shares, so MCP and tRPC grade errors identically.
 * `errorCode` is a `SilkweaveError`'s `code`, else the error's `name`, else
 * `'unknown'`; `statusCode` falls back to `500` (an unannotated throw is a
 * server fault - throw a 4xx `SilkweaveError` to mark a caller error).
 */
export function toolCallErrorMeta(
  error: unknown
): Required<Pick<ToolCallEvent, 'errorCode' | 'statusCode' | 'fault'>> & Pick<ToolCallEvent, 'errorMessage'> {
  const statusCode = thrownStatus(error) ?? 500
  const identity =
    error instanceof SilkweaveError
      ? { errorCode: error.code, errorMessage: error.message }
      : error instanceof Error
        ? { errorCode: error.name, errorMessage: error.message }
        : { errorCode: 'unknown' }
  return { ...identity, statusCode, fault: faultForStatus(statusCode) }
}

/** Error fields for an input-validation failure event (stable `INVALID_ARGUMENTS`, 400, client fault). */
export function invalidArgumentsMeta(
  errorMessage: string
): Required<Pick<ToolCallEvent, 'errorCode' | 'errorMessage' | 'statusCode' | 'fault'>> {
  return { errorCode: 'INVALID_ARGUMENTS', errorMessage, statusCode: 400, fault: 'client' }
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
  if (!hook) {
    return
  }
  try {
    void Promise.resolve(hook(event)).catch((error: unknown) => {
      console.error('onToolCall hook error:', error)
    })
  } catch (error) {
    console.error('onToolCall hook error:', error)
  }
}
