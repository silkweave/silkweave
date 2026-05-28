import { AuthConfig, AuthInfo, validateToken } from '@silkweave/auth'
import { SilkweaveContext } from '@silkweave/core'
import { type RequestHandler } from 'express'
import { AsyncLocalStorage } from 'node:async_hooks'

/**
 * Per-request bearer-token storage used by tool handlers to read the resolved
 * `AuthInfo` for the currently-handled MCP call.
 */
export const authStorage = new AsyncLocalStorage<AuthInfo>()

/**
 * Express middleware that validates the `Authorization: Bearer …` header via
 * the supplied `AuthConfig`. On success the resolved `AuthInfo` is placed in
 * `authStorage` for the duration of the downstream handler - `mcpTransport`'s
 * tool callbacks pick it up to populate the silkweave context's `auth` key.
 *
 * The middleware should NOT be applied to OAuth-discovery / token routes -
 * compose it only on the routes that require an authenticated caller (the MCP
 * transport itself, sideload, etc.).
 */
export function authMiddleware(auth: AuthConfig, context: SilkweaveContext): RequestHandler {
  return async (req, res, next) => {
    const result = await validateToken(req.headers.authorization, auth, context.fork({ request: req }))
    if (result.error) {
      for (const [key, value] of Object.entries(result.error.headers)) { res.header(key, value) }
      res.status(result.error.statusCode).json(result.error.body)
      return
    }
    if (result.auth) {
      authStorage.run(result.auth, () => { next() })
    } else {
      next()
    }
  }
}
