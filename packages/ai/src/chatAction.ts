import { createAction } from '@silkweave/core'
import {
  convertToModelMessages,
  streamText,
  type LanguageModel,
  type ToolSet,
  type UIMessage,
  type UIMessageChunk
} from 'ai'
import z from 'zod/v4'

export interface CreateChatActionOptions {
  /** Action name. Defaults to `'chat'`. */
  name?: string
  /** Action description (shown to MCP clients, tRPC docs, etc). */
  description?: string
  /** The language model to drive (e.g. `anthropic('claude-sonnet-4-6')`). */
  model: LanguageModel
  /** System prompt prepended to every conversation. */
  system?: string
  /** Tools registered with `streamText`. */
  tools?: ToolSet
  /** Max model output tokens. */
  maxOutputTokens?: number
  /** Model temperature. */
  temperature?: number
}

/**
 * Build a Silkweave streaming action that wraps Vercel AI SDK's `streamText`.
 *
 * The action accepts the shape `useChat` sends through a custom
 * `ChatTransport` (`messages`, `trigger`, `chatId`, `messageId`) and yields
 * the same `UIMessageChunk`s that AI SDK's `result.toUIMessageStream()`
 * produces - so a paired `silkweaveTransport()` on the client can feed them
 * straight into `useChat` with no wire-format translation.
 *
 * @example
 * ```ts
 * import { silkweave } from '@silkweave/core'
 * import { trpc } from '@silkweave/trpc'
 * import { createChatAction } from '@silkweave/ai'
 * import { anthropic } from '@ai-sdk/anthropic'
 *
 * const ChatAction = createChatAction({
 *   model: anthropic('claude-sonnet-4-6'),
 *   system: 'You are a helpful assistant.'
 * })
 *
 * await silkweave({ name: 'chat-server', version: '1.0.0' })
 *   .adapter(trpc({ port: 8080 }))
 *   .action(ChatAction)
 *   .start()
 * ```
 */
export function createChatAction(options: CreateChatActionOptions) {
  return createAction({
    name: options.name ?? 'chat',
    description: options.description ?? 'Chat with the assistant',
    input: z.object({
      messages: z.array(z.any()),
      trigger: z.enum(['submit-message', 'regenerate-message']).optional(),
      chatId: z.string().optional(),
      messageId: z.string().optional(),
      metadata: z.any().optional(),
      body: z.record(z.string(), z.any()).optional(),
      headers: z.record(z.string(), z.string()).optional()
    }),
    chunk: z.custom<UIMessageChunk>(),
    run: async function* ({ messages }) {
      const uiMessages = messages as UIMessage[]
      const result = streamText({
        model: options.model,
        system: options.system,
        // `convertToModelMessages` became async in AI SDK v7. Awaiting is a no-op on
        // v5/v6, where it returns the array directly, so this works across all three.
        messages: await convertToModelMessages(uiMessages),
        tools: options.tools,
        maxOutputTokens: options.maxOutputTokens,
        temperature: options.temperature
      })
      for await (const chunk of result.toUIMessageStream()) {
        yield chunk
      }
    }
  })
}
