import { Action, SilkweaveError } from '@silkweave/core'

/**
 * Normalized request stand-in handed to `filterActions` - the same shape for
 * the Express `http()` transport and the Web-Standard `edge()` adapter.
 */
export interface FilterRequest {
  /** Inbound HTTP headers (lower-cased keys, as delivered by the host). */
  headers: Record<string, string | string[] | undefined>
  /** Full request URL (or path, as delivered by the host). */
  url: string
  /**
   * JSON-RPC method of the POSTed message (`'initialize'`, `'tools/list'`,
   * `'tools/call'`, `'ping'`, ...). Lets the callback skip expensive
   * permission lookups on `initialize`/`ping`, and doubles as an
   * observability tap (e.g. counting `tools/list`). Empty string when the body
   * is not a recognizable JSON-RPC message. JSON-RPC batches are rejected by the
   * transport before the filter runs, so this always reflects a single message.
   */
  method: string
  /** `params.name` of a `tools/call` message; unset for every other method. */
  toolName?: string
}

/**
 * Per-request tool filter for the stateless MCP transports. Runs before
 * `registerTools()` on every `POST /mcp`; only the returned actions exist for
 * that request (`tools/list` and `tools/call` alike - a client that cached a
 * wider list is still denied). May be async (e.g. a DB lookup of API-key
 * permissions).
 *
 * Error semantics: a thrown `SilkweaveError` propagates as its `statusCode`
 * (e.g. 401 invalid key, 403 insufficient permissions) with a JSON-RPC error
 * body; any other throw maps to HTTP 500. A thrown error NEVER degrades to an
 * empty tool list - return `[]` explicitly if "no tools" is the intended
 * answer.
 */
export type FilterActions = (actions: Action[], request: FilterRequest) => Action[] | Promise<Action[]>

/**
 * Extract the JSON-RPC `method` (and `toolName` for `tools/call`) from a
 * parsed request body. Tolerates a legacy batch (first request wins) and
 * unrecognizable bodies (empty `method`).
 */
export function rpcInfo(body: unknown): { method: string; toolName?: string } {
  const message = (Array.isArray(body) ? body[0] : body) as
    | { method?: unknown; params?: { name?: unknown } }
    | undefined
  const method = typeof message?.method === 'string' ? message.method : ''
  const toolName =
    method === 'tools/call' && typeof message?.params?.name === 'string' ? message.params.name : undefined
  return { method, ...(toolName !== undefined ? { toolName } : {}) }
}

/**
 * Map a `filterActions` throw to an HTTP status + JSON-RPC error body: a
 * `SilkweaveError` keeps its `statusCode` (so an invalid key surfaces as an
 * auth failure, not "server has no tools"), anything else is a 500. `id` is
 * echoed from the request body when available.
 */
export function filterErrorResponse(error: unknown, body: unknown): { status: number; body: object } {
  const message = (Array.isArray(body) ? body[0] : body) as { id?: unknown } | undefined
  const id = message?.id ?? null
  if (error instanceof SilkweaveError) {
    return {
      status: error.statusCode,
      body: { jsonrpc: '2.0', error: { code: -32_000, message: error.message }, id }
    }
  }
  console.error('filterActions error:', error)
  return {
    status: 500,
    body: { jsonrpc: '2.0', error: { code: -32_603, message: 'Internal server error' }, id }
  }
}
