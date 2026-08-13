import { Action, ActionStreamRun, isStreamingAction } from './action.js'
import { SilkweaveContext } from './context.js'

/**
 * Drive a streaming action's async generator. Calls `onChunk` once per yielded
 * value and awaits it before pulling the next value from the generator - this
 * is what wires transport-level backpressure (SSE drain, stdout flush, tRPC
 * subscription consumer) back to the action.
 *
 * Returns the buffered array of all chunks. Use this for non-streaming
 * adapters or when a client has opted out of streaming (e.g. no MCP
 * `progressToken`). Pass `onChunk` to also emit each chunk on the wire.
 */
export async function runStreamingAction<C>(
  action: Action<any, any, string, any, C>,
  input: object,
  context: SilkweaveContext,
  onChunk?: (chunk: C, index: number) => void | Promise<void>
): Promise<C[]> {
  if (!isStreamingAction(action)) {
    throw new Error(`Action ${action.name} is not a streaming action`)
  }
  const run = action.run as ActionStreamRun<object, C>
  const iter = run(input, context)
  const chunks: C[] = []
  let index = 0
  for await (const chunk of iter) {
    chunks.push(chunk)
    if (onChunk) {
      await onChunk(chunk, index)
    }
    index += 1
  }
  return chunks
}
