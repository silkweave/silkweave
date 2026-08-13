import type { ChatTransport, UIMessage, UIMessageChunk } from 'ai'

/**
 * Input passed to the underlying `subscribe` function. Mirrors the relevant
 * fields of `ChatTransport.sendMessages`'s options object - what the chat
 * action needs to drive the model - minus the `AbortSignal` (which is wired
 * separately via `unsubscribe()`).
 */
export interface SilkweaveTransportInput<M extends UIMessage = UIMessage> {
  messages: M[]
  trigger: 'submit-message' | 'regenerate-message'
  chatId: string
  messageId: string | undefined
  metadata?: unknown
  body?: Record<string, unknown>
  headers?: Record<string, string>
}

/**
 * Callback shape passed to the subscribe function. `onData` is typed as
 * `unknown` at the transport boundary (rather than the precise
 * `UIMessageChunk` union) because tRPC v11's `subscribe()` expects callbacks
 * compatible with the *inferred* subscription output, which can differ
 * subtly from `UIMessageChunk` due to how Zod erases discriminated-union
 * variance (e.g. `input?: unknown` vs `input: unknown`). At runtime the
 * server's `createChatAction` only yields valid `UIMessageChunk`s, so the
 * cast is safe.
 */
export interface SilkweaveTransportCallbacks {
  onData: (chunk: unknown) => void
  onError: (error: unknown) => void
  onComplete: () => void
}

export interface SilkweaveTransportSubscription {
  unsubscribe: () => void
}

/**
 * The subscribe function. The shape is compatible with tRPC v11's
 * `client.<procedure>.subscribe(input, callbacks)` callsite - wrap your tRPC
 * subscription procedure in this and pass it to `silkweaveTransport()`.
 */
export type SilkweaveSubscribe<M extends UIMessage = UIMessage> = (
  input: SilkweaveTransportInput<M>,
  callbacks: SilkweaveTransportCallbacks
) => SilkweaveTransportSubscription

/**
 * Build a custom `ChatTransport` for Vercel AI SDK's `useChat` that delivers
 * `UIMessageChunk`s over a `subscribe` function (typically a tRPC subscription
 * procedure wired to a Silkweave streaming action).
 *
 * Skips AI SDK's Data Stream Protocol entirely - chunks are JS objects
 * delivered via the consumer-supplied transport, not parsed from prefix-coded
 * HTTP bodies. This means the wire format is whatever your subscribe function
 * uses (tRPC over SSE or WebSocket, in the typical case).
 *
 * @example
 * ```ts
 * import { silkweaveTransport } from '@silkweave/ai'
 * import { trpc } from './trpc-client'
 *
 * const transport = silkweaveTransport((input, callbacks) =>
 *   trpc.chat.subscribe(input, callbacks)
 * )
 *
 * const { messages, sendMessage } = useChat({ transport })
 * ```
 *
 * `reconnectToStream()` returns `null` - stream resume after disconnect is not
 * supported. If a connection drops mid-stream the consumer must resend.
 */
export function silkweaveTransport<M extends UIMessage = UIMessage>(
  subscribe: SilkweaveSubscribe<M>
): ChatTransport<M> {
  return {
    async sendMessages({ messages, trigger, chatId, messageId, abortSignal, metadata, body, headers }: any) {
      let subscription: SilkweaveTransportSubscription | undefined
      return new ReadableStream<UIMessageChunk>({
        start(controller) {
          let closed = false
          const close = () => {
            if (closed) {
              return
            }
            closed = true
            try {
              controller.close()
            } catch {
              /* already closed */
            }
          }
          subscription = subscribe(
            { messages: messages as M[], trigger, chatId, messageId, metadata, body, headers },
            {
              onData: (chunk) => {
                if (closed) {
                  return
                }
                controller.enqueue(chunk as UIMessageChunk)
              },
              onError: (error) => {
                if (closed) {
                  return
                }
                closed = true
                controller.error(error)
              },
              onComplete: close
            }
          )
          if (abortSignal) {
            const onAbort = () => {
              subscription?.unsubscribe()
              close()
            }
            if (abortSignal.aborted) {
              onAbort()
            } else {
              abortSignal.addEventListener('abort', onAbort, { once: true })
            }
          }
        },
        // Cancelling the stream directly (without firing abortSignal) must still
        // tear down the tRPC subscription, else it leaks server-side.
        cancel() {
          subscription?.unsubscribe()
        }
      })
    },
    reconnectToStream() {
      return Promise.resolve(null)
    }
  }
}
