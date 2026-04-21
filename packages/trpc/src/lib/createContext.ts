import { AuthConfig, AuthInfo, validateToken } from '@silkweave/auth'
import { SilkweaveContext } from '@silkweave/core'
import { buildLogLevels, Logger, LogLevel } from '@silkweave/logger'

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
