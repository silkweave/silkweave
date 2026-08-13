import { AuthConfig, AuthInfo, validateToken } from '@silkweave/auth'
import { buildLogLevels, Logger, LogLevel, SilkweaveContext } from '@silkweave/core'
import { TRPCError } from '@trpc/server'
import { mapError } from './errors.js'

const CONSOLE_LEVEL_MAP: Record<LogLevel, 'log' | 'info' | 'warn' | 'error'> = {
  emergency: 'error',
  alert: 'error',
  critical: 'error',
  error: 'error',
  warning: 'warn',
  notice: 'info',
  info: 'info',
  debug: 'log'
}

export function createActionLogger(): Logger {
  return {
    ...buildLogLevels((level, data) => {
      console[CONSOLE_LEVEL_MAP[level]](data)
    }),
    progress: () => {
      /* progress notifications not supported on tRPC HTTP */
    }
  }
}

export interface AuthErrorPayload {
  statusCode: number
  headers: Record<string, string>
  body: { error: string; error_description: string }
}

export type ResolvedAuth = { kind: 'ok'; authInfo?: AuthInfo } | { kind: 'error'; error: AuthErrorPayload }

export async function resolveAuth(
  auth: AuthConfig | undefined,
  authHeader: string | null | undefined,
  context: SilkweaveContext
): Promise<ResolvedAuth> {
  if (!auth) {
    return { kind: 'ok' }
  }
  const result = await validateToken(authHeader, auth, context)
  if (result.error) {
    return { kind: 'error', error: result.error }
  }
  return { kind: 'ok', authInfo: result.auth }
}

/**
 * Resolve a caller's identity from the request itself rather than from a bearer
 * token - typically a session cookie, which is what a same-origin SPA (and a
 * browser WebSocket upgrade, which cannot carry an `Authorization` header) has.
 *
 * Return `AuthInfo` to authenticate, or `null` to fall through to the bearer
 * path (so one endpoint can accept a cookie from the browser and a token from an
 * agent). Throw a `SilkweaveError` to reject with a specific status.
 *
 * The `AuthInfo` you return lands on the same `auth` context key the MCP path
 * uses, so one action's `run()` serves both callers unchanged. `AuthInfo.token`
 * is required - set it to the session identifier.
 *
 * **This bypasses every check `validateToken` performs** - expiry, issuer (RFC
 * 9207), audience (RFC 8707), and required scopes (SEP-2350). That is correct,
 * because what you are validating is not a token; but it means validation is
 * entirely yours. Do not reach for this as a "custom token validator".
 *
 * **CSRF**: the moment a cookie authenticates this endpoint, it inherits a
 * browser threat model that bearer endpoints are structurally immune to. Note
 * that `kind: 'query'` actions execute on `GET` and `SameSite=Lax` cookies ride
 * top-level `GET` navigations, so a side-effectful query is one link away from
 * being triggered cross-site. Pair this with `SameSite` cookies, check `Origin`
 * or `Sec-Fetch-Site` (you receive the whole request precisely so you can), and
 * keep side effects out of queries.
 */
export type Authenticate<Req> = (req: Req) => AuthInfo | null | Promise<AuthInfo | null>

/** 401 for a resolver-only endpoint: no `WWW-Authenticate`, since advertising OAuth discovery on a cookie endpoint misleads. */
const UNAUTHENTICATED: AuthErrorPayload = {
  statusCode: 401,
  headers: {},
  body: { error: 'unauthorized', error_description: 'Not authenticated' }
}

/**
 * The identity chain shared by every tRPC adapter: `authenticate` first, then
 * the bearer `auth` path when it declines, then a bare 401 if neither applies.
 */
export async function resolveIdentity<Req>(
  authenticate: Authenticate<Req> | undefined,
  auth: AuthConfig | undefined,
  request: Req,
  authHeader: string | null | undefined,
  context: SilkweaveContext
): Promise<ResolvedAuth> {
  if (authenticate) {
    let authInfo: AuthInfo | null
    try {
      authInfo = await authenticate(request)
    } catch (error) {
      // A raw throw out of createContext is swallowed by @trpc/server and
      // surfaces as an opaque 500, so map it to a TRPCError here.
      throw mapError(error)
    }
    if (authInfo) {
      return { kind: 'ok', authInfo }
    }
    // Declined: fall through to the bearer path so one endpoint can serve a
    // cookie-bearing browser and a token-bearing agent.
    if (!auth) {
      return { kind: 'error', error: UNAUTHENTICATED }
    }
  }
  return resolveAuth(auth, authHeader, context)
}

/**
 * Carries the OAuth challenge (status + `WWW-Authenticate`/resource-metadata
 * headers) from a failed `createContext` to `authResponseMeta`. Attached as the
 * `cause` of a `TRPCError` so the tRPC handler owns the whole response
 * lifecycle - the adapter must never write/end the raw response itself (doing so
 * races tRPC's own error write and crashes the process with
 * `ERR_STREAM_WRITE_AFTER_END`).
 */
export class AuthChallengeError extends Error {
  constructor(public readonly payload: AuthErrorPayload) {
    super(payload.body.error_description || payload.body.error || 'Unauthorized')
    this.name = 'AuthChallengeError'
  }
}

/**
 * Throw a resolved auth error as a `TRPCError` so the tRPC handler (standalone
 * or fetch) produces the response. `authResponseMeta` then upgrades that
 * response to the OAuth status + challenge headers via the `AuthChallengeError`
 * cause. Never write to `res` directly from `createContext`.
 */
export function throwAuthError(payload: AuthErrorPayload): never {
  throw new TRPCError({
    code: payload.statusCode === 403 ? 'FORBIDDEN' : 'UNAUTHORIZED',
    message: payload.body.error_description || payload.body.error || 'Unauthorized',
    cause: new AuthChallengeError(payload)
  })
}

/**
 * tRPC `responseMeta` that surfaces an auth challenge: when a request's errors
 * carry an `AuthChallengeError`, override the HTTP status (401/403) and set the
 * OAuth challenge headers so discovery/step-up flows work. Shared by the
 * standalone (`createHTTPHandler`) and fetch (`fetchRequestHandler`) adapters.
 */
export function authResponseMeta(opts: { errors: readonly { cause?: unknown }[] }): {
  status?: number
  headers?: Record<string, string>
} {
  for (const err of opts.errors) {
    if (err.cause instanceof AuthChallengeError) {
      return { status: err.cause.payload.statusCode, headers: err.cause.payload.headers }
    }
  }
  return {}
}
