import { AuthConfig, AuthInfo, validateToken } from '@silkweave/auth'
import { buildLogLevels, Logger, LogLevel, SilkweaveContext } from '@silkweave/core'
import { TRPCError } from '@trpc/server'

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
    progress: () => { /* progress notifications not supported on tRPC HTTP */ }
  }
}

export interface AuthErrorPayload {
  statusCode: number
  headers: Record<string, string>
  body: { error: string; error_description: string }
}

export type ResolvedAuth =
  | { kind: 'ok'; authInfo?: AuthInfo }
  | { kind: 'error'; error: AuthErrorPayload }

export async function resolveAuth(
  auth: AuthConfig | undefined,
  authHeader: string | null | undefined,
  context: SilkweaveContext
): Promise<ResolvedAuth> {
  if (!auth) { return { kind: 'ok' } }
  const result = await validateToken(authHeader, auth, context)
  if (result.error) { return { kind: 'error', error: result.error } }
  return { kind: 'ok', authInfo: result.auth }
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
export function authResponseMeta(
  opts: { errors: readonly { cause?: unknown }[] }
): { status?: number; headers?: Record<string, string> } {
  for (const err of opts.errors) {
    if (err.cause instanceof AuthChallengeError) {
      return { status: err.cause.payload.statusCode, headers: err.cause.payload.headers }
    }
  }
  return {}
}
