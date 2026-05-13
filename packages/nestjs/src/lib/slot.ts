import type { IncomingMessage, ServerResponse } from 'http'

export type NodeMiddleware = (
  req: IncomingMessage,
  res: ServerResponse,
  next?: (err?: unknown) => void
) => unknown

/**
 * A mountable middleware slot that delegates to a settable handler. Used to
 * reserve a path on Nest's HTTP server *before* its 404 catch-all is
 * installed, then populate the real handler later in `OnApplicationBootstrap`.
 *
 * Before `set()` is called, the slot responds with HTTP 503.
 */
export interface MiddlewareSlot {
  middleware: NodeMiddleware
  set(handler: NodeMiddleware): void
}

export function createMiddlewareSlot(label: string): MiddlewareSlot {
  let handler: NodeMiddleware = (_req, res) => {
    res.statusCode = 503
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ error: 'not_ready', message: `${label} adapter has not started yet` }))
  }
  return {
    middleware: (req, res, next) => handler(req, res, next),
    set: (h) => { handler = h }
  }
}

interface HttpAdapterUseLike {
  use(path: string, handler: NodeMiddleware): unknown
}

/**
 * Mount a middleware slot at the given base path on Nest's HTTP adapter and
 * return the slot's `set()` callback. The slot middleware is installed
 * synchronously so it sits in the Express stack before Nest's later-installed
 * 404 catch-all.
 */
export function reserveSlot(
  httpAdapter: HttpAdapterUseLike,
  basePath: string,
  label: string
): (handler: NodeMiddleware) => void {
  const slot = createMiddlewareSlot(label)
  httpAdapter.use(basePath, slot.middleware)
  return slot.set
}
