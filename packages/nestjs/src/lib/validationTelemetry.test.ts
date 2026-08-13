import { createContext, SilkweaveError, type Action, type ToolCallEvent } from '@silkweave/core'
import { TRPCError } from '@trpc/server'
import { describe, expect, it } from 'vitest'
import { z } from 'zod/v4'
import { buildValidationErrorEmitter, type TrpcErrorEvent } from './validationTelemetry.js'

const actions = [
  {
    name: 'Reports.echo',
    description: 'echo',
    input: z.object({ day: z.string() }),
    run: async (input: object) => input
  } as Action
]

function collect() {
  const events: ToolCallEvent[] = []
  return {
    events,
    onToolCall: (event: ToolCallEvent) => {
      events.push(event)
    }
  }
}

/** emitToolCall defers the hook through a resolved promise - flush it. */
const flush = () =>
  new Promise((resolve) => {
    setTimeout(resolve, 0)
  })

function zodValidationError(): TRPCError {
  const parsed = z.object({ day: z.string() }).safeParse({ day: 42 })
  return new TRPCError({ code: 'BAD_REQUEST', message: parsed.error!.message, cause: parsed.error })
}

function errorEvent(overrides: Partial<TrpcErrorEvent> = {}): TrpcErrorEvent {
  return { error: zodValidationError(), path: 'reportsEcho', input: { day: 42 }, ctx: undefined, ...overrides }
}

describe('buildValidationErrorEmitter', () => {
  it('returns undefined without a hook (no onError overhead)', () => {
    expect(buildValidationErrorEmitter(actions, createContext(), undefined)).toBeUndefined()
  })

  it('emits an INVALID_ARGUMENTS event with the raw offered input, mapped to the action name', async () => {
    const { events, onToolCall } = collect()
    const baseContext = createContext()
    buildValidationErrorEmitter(actions, baseContext, onToolCall)!(errorEvent())
    await flush()
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      action: 'Reports.echo',
      tool: 'reportsEcho',
      transport: 'trpc',
      durationMs: 0,
      ok: false,
      errorCode: 'INVALID_ARGUMENTS',
      args: { day: 42 },
      context: baseContext
    })
  })

  it('prefers the per-request context when tRPC supplies one', async () => {
    const { events, onToolCall } = collect()
    const requestContext = createContext({ adapter: 'trpc' })
    buildValidationErrorEmitter(actions, createContext(), onToolCall)!(
      errorEvent({ ctx: { silkweaveContext: requestContext } })
    )
    await flush()
    expect(events[0].context).toBe(requestContext)
  })

  it('ignores resolver errors (SilkweaveError cause) - the action wrapper already emitted those', async () => {
    const { events, onToolCall } = collect()
    const resolverError = new TRPCError({
      code: 'FORBIDDEN',
      message: 'no access',
      cause: new SilkweaveError('no access', 'http_error', 403)
    })
    buildValidationErrorEmitter(actions, createContext(), onToolCall)!(errorEvent({ error: resolverError }))
    await flush()
    expect(events).toHaveLength(0)
  })

  it('ignores errors with no path (unmatched procedure)', async () => {
    const { events, onToolCall } = collect()
    buildValidationErrorEmitter(actions, createContext(), onToolCall)!(errorEvent({ path: undefined }))
    await flush()
    expect(events).toHaveLength(0)
  })
})
