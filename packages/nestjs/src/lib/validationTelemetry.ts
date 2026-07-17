import { emitToolCall, type Action, type OnToolCall, type SilkweaveContext } from '@silkweave/core'
import type { TrpcHandlerContext } from '@silkweave/trpc'
import type { TRPCError } from '@trpc/server'
import { camelCase } from 'change-case'

/** The subset of tRPC's `onError` options the emitter reads. */
export interface TrpcErrorEvent {
  error: TRPCError
  path: string | undefined
  input: unknown
  ctx: TrpcHandlerContext | undefined
}

/**
 * `onError` seam for input-validation telemetry (internal - wired by the
 * `trpc()` adapter). tRPC parses a procedure's input BEFORE the resolver, so
 * the synthesized action wrapper (which emits resolver/guard failures) never
 * runs for an invalid-arguments call - this hook is the only place such calls
 * become visible to `onToolCall`. Emits `ok: false` with the stable
 * `errorCode: 'INVALID_ARGUMENTS'` and `args` set to the raw offered input;
 * batched requests arrive here already de-batched (one `onError` per failing
 * procedure).
 *
 * Discrimination is by `cause`: tRPC wraps a validator failure in a
 * `TRPCError` whose `cause` is the `ZodError` (name-checked, so a second zod
 * copy still matches). Resolver errors reach `onError` as `SilkweaveError`
 * causes (the wrapper maps them via `toSilkweaveError`) and are not
 * re-counted - the one blind spot is a controller that deliberately throws a
 * raw `ZodError`, which is indistinguishable from an input-parse failure and
 * would count twice.
 */
export function buildValidationErrorEmitter(
  actions: Action[],
  baseContext: SilkweaveContext,
  onToolCall: OnToolCall | undefined
): ((event: TrpcErrorEvent) => void) | undefined {
  if (!onToolCall) { return undefined }
  const actionNameByKey = new Map(actions.map((action) => [camelCase(action.name), action.name]))
  return ({ error, path, input, ctx }) => {
    if (!path || error.cause?.name !== 'ZodError') { return }
    emitToolCall(onToolCall, {
      action: actionNameByKey.get(path) ?? path,
      tool: path,
      transport: 'trpc',
      durationMs: 0,
      ok: false,
      errorCode: 'INVALID_ARGUMENTS',
      errorMessage: error.message,
      args: input,
      context: ctx?.silkweaveContext ?? baseContext
    })
  }
}
