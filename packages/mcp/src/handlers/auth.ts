import { AuthConfig, AuthInfo, validateToken } from '@silkweave/auth'
import { SilkweaveContext } from '@silkweave/core'
import { type Request, type RequestHandler } from 'express'

/**
 * Key under which `authMiddleware` stashes the resolved `AuthInfo` on the
 * Express request. `mcpTransport` reads it back and forks it into the per-request
 * silkweave context (whose `fork` the tool-call context inherits), so auth
 * reaches tool handlers without `AsyncLocalStorage` - keeping this handler set
 * free of `node:async_hooks` for edge/serverless portability.
 */
export const AUTH_REQUEST_KEY = '__silkweaveAuth'

/** Read the `AuthInfo` a prior `authMiddleware` attached to the request, if any. */
export function authFromRequest(req: Request): AuthInfo | undefined {
  return (req as Request & { [AUTH_REQUEST_KEY]?: AuthInfo })[AUTH_REQUEST_KEY]
}

/**
 * Express middleware that validates the `Authorization: Bearer …` header via
 * the supplied `AuthConfig`. On success the resolved `AuthInfo` is attached to
 * the request (see `authFromRequest` / `AUTH_REQUEST_KEY`); `mcpTransport` forks
 * it into the silkweave context for the tool call.
 *
 * The middleware should NOT be applied to OAuth-discovery / token routes -
 * compose it only on the routes that require an authenticated caller (the MCP
 * transport itself, sideload, etc.).
 */
export function authMiddleware(auth: AuthConfig, context: SilkweaveContext): RequestHandler {
  return async (req, res, next) => {
    const result = await validateToken(req.headers.authorization, auth, context.fork({ request: req }))
    if (result.error) {
      for (const [key, value] of Object.entries(result.error.headers)) {
        res.header(key, value)
      }
      res.status(result.error.statusCode).json(result.error.body)
      return
    }
    if (result.auth) {
      ;(req as Request & { [AUTH_REQUEST_KEY]?: AuthInfo })[AUTH_REQUEST_KEY] = result.auth
    }
    next()
  }
}
