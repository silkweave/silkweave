/* eslint-disable @typescript-eslint/no-explicit-any */
import { Action, ActionRun, ActionStreamRun, isStreamingAction, SilkweaveContext } from '@silkweave/core'
import { initTRPC } from '@trpc/server'
import { camelCase } from 'change-case'
import { mapError } from './errors.js'

export interface TrpcHandlerContext {
  silkweaveContext: SilkweaveContext
}

export function buildRouter(actions: Action[]) {
  const t = initTRPC.context<TrpcHandlerContext>().create()
  const record: Record<string, any> = {}
  for (const action of actions) {
    const key = camelCase(action.name)
    const base = t.procedure.input(action.input)
    if (isStreamingAction(action)) {
      const streamRun = action.run as ActionStreamRun<object, unknown>
      record[key] = base.subscription(async function* ({ input, ctx, signal }) {
        try {
          const iter = streamRun(input as object, ctx.silkweaveContext)
          for await (const chunk of iter) {
            if (signal?.aborted) { return }
            yield chunk
          }
        } catch (error) {
          throw mapError(error)
        }
      })
    } else {
      const runFn = action.run as ActionRun<object, object>
      const handler = async ({ input, ctx }: { input: object; ctx: TrpcHandlerContext }) => {
        try {
          return await runFn(input, ctx.silkweaveContext)
        } catch (error) {
          throw mapError(error)
        }
      }
      record[key] = action.kind === 'query' ? base.query(handler) : base.mutation(handler)
    }
  }
  return t.router(record)
}
