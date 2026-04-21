import { SilkweaveError } from '@silkweave/core'
import { TRPCError } from '@trpc/server'
import { z } from 'zod'

type TRPCErrorCode = TRPCError['code']

const CODE_MAP: Record<number, TRPCErrorCode> = {
  400: 'BAD_REQUEST',
  401: 'UNAUTHORIZED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  408: 'TIMEOUT',
  409: 'CONFLICT',
  412: 'PRECONDITION_FAILED',
  413: 'PAYLOAD_TOO_LARGE',
  429: 'TOO_MANY_REQUESTS',
  499: 'CLIENT_CLOSED_REQUEST',
  500: 'INTERNAL_SERVER_ERROR',
  501: 'NOT_IMPLEMENTED',
  502: 'BAD_GATEWAY',
  503: 'SERVICE_UNAVAILABLE',
  504: 'GATEWAY_TIMEOUT'
}

export function mapError(error: unknown): TRPCError {
  if (error instanceof TRPCError) { return error }
  if (error instanceof z.ZodError) {
    return new TRPCError({ code: 'BAD_REQUEST', message: error.message, cause: error })
  }
  if (error instanceof SilkweaveError) {
    return new TRPCError({
      code: CODE_MAP[error.statusCode] ?? 'INTERNAL_SERVER_ERROR',
      message: error.message,
      cause: error
    })
  }
  return new TRPCError({
    code: 'INTERNAL_SERVER_ERROR',
    message: error instanceof Error ? error.message : 'Internal error',
    cause: error instanceof Error ? error : undefined
  })
}
