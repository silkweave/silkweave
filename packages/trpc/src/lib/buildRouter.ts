/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment */
import { Action, ActionRun, ActionStreamRun, isStreamingAction, SilkweaveContext } from '@silkweave/core'
import { initTRPC } from '@trpc/server'
import { camelCase } from 'change-case'
import { mapError } from './errors.js'

export interface TrpcHandlerContext {
  silkweaveContext: SilkweaveContext
}

/** A streaming action becomes a `.subscription()` yielding its chunks directly. */
function subscriptionProcedure(base: any, action: Action) {
  const streamRun = action.run as ActionStreamRun<object, unknown>
  return base.subscription(async function* ({ input, ctx, signal }: { input: unknown; ctx: TrpcHandlerContext; signal?: AbortSignal }) {
    try {
      for await (const chunk of streamRun(input as object, ctx.silkweaveContext)) {
        if (signal?.aborted) { return }
        yield chunk
      }
    } catch (error) {
      throw mapError(error)
    }
  })
}

/** A buffered action becomes a `.query()` or `.mutation()` per `action.kind`. */
function bufferedProcedure(base: any, action: Action) {
  const runFn = action.run as ActionRun<object, object>
  const handler = async ({ input, ctx }: { input: object; ctx: TrpcHandlerContext }) => {
    try {
      return await runFn(input, ctx.silkweaveContext)
    } catch (error) {
      throw mapError(error)
    }
  }
  return action.kind === 'query' ? base.query(handler) : base.mutation(handler)
}

export function buildRouter(actions: Action[]) {
  const t = initTRPC.context<TrpcHandlerContext>().create()
  const record: Record<string, any> = {}
  for (const action of actions) {
    const base = t.procedure.input(action.input)
    record[camelCase(action.name)] = isStreamingAction(action)
      ? subscriptionProcedure(base, action)
      : bufferedProcedure(base, action)
  }
  return t.router(record)
}
