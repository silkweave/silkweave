import { SilkweaveError } from '@silkweave/core'
import { TRPCError } from '@trpc/server'
import { z } from 'zod/v4'

type TRPCErrorCode = TRPCError['code']

// Every HTTP status tRPC has a code for (as of @trpc/server 11.18, our floor).
// A status missing here would degrade a caller error (e.g. NestJS's 422
// UnprocessableEntityException) to a 500 on the wire.
const CODE_MAP: Record<number, TRPCErrorCode> = {
  400: 'BAD_REQUEST',
  401: 'UNAUTHORIZED',
  402: 'PAYMENT_REQUIRED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  405: 'METHOD_NOT_SUPPORTED',
  408: 'TIMEOUT',
  409: 'CONFLICT',
  412: 'PRECONDITION_FAILED',
  413: 'PAYLOAD_TOO_LARGE',
  415: 'UNSUPPORTED_MEDIA_TYPE',
  422: 'UNPROCESSABLE_CONTENT',
  428: 'PRECONDITION_REQUIRED',
  429: 'TOO_MANY_REQUESTS',
  499: 'CLIENT_CLOSED_REQUEST',
  500: 'INTERNAL_SERVER_ERROR',
  501: 'NOT_IMPLEMENTED',
  502: 'BAD_GATEWAY',
  503: 'SERVICE_UNAVAILABLE',
  504: 'GATEWAY_TIMEOUT'
}

/**
 * tRPC code for an HTTP status. A 4xx tRPC has no code for (e.g. 418) maps to
 * BAD_REQUEST rather than INTERNAL_SERVER_ERROR, so the wire status agrees
 * with telemetry's `fault: 'client'` for the same call.
 */
function codeForStatus(statusCode: number): TRPCErrorCode {
  return CODE_MAP[statusCode] ?? (statusCode >= 400 && statusCode < 500 ? 'BAD_REQUEST' : 'INTERNAL_SERVER_ERROR')
}

export function mapError(error: unknown): TRPCError {
  if (error instanceof TRPCError) {
    return error
  }
  if (error instanceof z.ZodError) {
    return new TRPCError({ code: 'BAD_REQUEST', message: error.message, cause: error })
  }
  if (error instanceof SilkweaveError) {
    return new TRPCError({
      code: codeForStatus(error.statusCode),
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
