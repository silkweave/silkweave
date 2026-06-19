import { SilkweaveError } from '@silkweave/core'
import { TRPCError } from '@trpc/server'
import { describe, expect, it } from 'vitest'
import { z } from 'zod/v4'
import { mapError } from './errors.js'

describe('mapError', () => {
  it('passes a TRPCError through unchanged', () => {
    const err = new TRPCError({ code: 'CONFLICT', message: 'dup' })
    expect(mapError(err)).toBe(err)
  })

  it('maps a ZodError to BAD_REQUEST, carrying its message', () => {
    const zerr = new z.ZodError([])
    const result = mapError(zerr)
    expect(result.code).toBe('BAD_REQUEST')
    expect(result.message).toBe(zerr.message)
  })

  it('maps a SilkweaveError statusCode to the matching tRPC code', () => {
    expect(mapError(new SilkweaveError('x', 'bad_request', 400)).code).toBe('BAD_REQUEST')
    expect(mapError(new SilkweaveError('x', 'unauthorized', 401)).code).toBe('UNAUTHORIZED')
    expect(mapError(new SilkweaveError('denied', 'forbidden', 403)).code).toBe('FORBIDDEN')
    expect(mapError(new SilkweaveError('x', 'not_found', 404)).code).toBe('NOT_FOUND')
    expect(mapError(new SilkweaveError('x', 'rate', 429)).code).toBe('TOO_MANY_REQUESTS')
  })

  it('preserves the SilkweaveError message and cause', () => {
    const err = new SilkweaveError('session not allowed', 'forbidden', 403)
    const result = mapError(err)
    expect(result.message).toBe('session not allowed')
    expect(result.cause).toBe(err)
  })

  it('falls back to INTERNAL_SERVER_ERROR for an unmapped status code', () => {
    expect(mapError(new SilkweaveError('teapot', 'teapot', 418)).code).toBe('INTERNAL_SERVER_ERROR')
  })

  it('maps a plain Error to INTERNAL_SERVER_ERROR, preserving message and cause', () => {
    const err = new Error('boom')
    const result = mapError(err)
    expect(result.code).toBe('INTERNAL_SERVER_ERROR')
    expect(result.message).toBe('boom')
    expect(result.cause).toBe(err)
  })

  it('maps a non-Error throw to a generic internal error with no cause', () => {
    const result = mapError('just a string')
    expect(result.code).toBe('INTERNAL_SERVER_ERROR')
    expect(result.message).toBe('Internal error')
    expect(result.cause).toBeUndefined()
  })
})
