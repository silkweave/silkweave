# @silkweave/ai

Vercel AI SDK integration for [Silkweave](https://github.com/silkweave/silkweave) - bridge `useChat` to a tRPC subscription backed by a Silkweave streaming action, with no Data Stream Protocol in the middle.

## Install

```bash
pnpm add @silkweave/ai @silkweave/core ai
# plus whichever provider you want
pnpm add @ai-sdk/anthropic
```

`ai` (Vercel AI SDK v5+) is a peer dependency.

## What's Inside

| Export | What it does |
|---|---|
| `createChatAction({ model, ... })` | Server-side: wraps AI SDK's `streamText` in a streaming Silkweave action that yields `UIMessageChunk`s - the exact shape `useChat` expects. |
| `silkweaveTransport(subscribe)` | Client-side: builds a custom `ChatTransport` for `useChat` that consumes any subscribe-style function (typically a tRPC subscription procedure) and surfaces chunks as a `ReadableStream<UIMessageChunk>`. |

## Why this exists

Vercel AI SDK's `useChat` ships with `DefaultChatTransport`, which expects an HTTP endpoint emitting AI SDK's prefix-coded "Data Stream Protocol". If your backend is tRPC, that means writing a separate non-tRPC route, losing your existing typed client, auth, and middleware.

A custom `ChatTransport` returns `Promise<ReadableStream<UIMessageChunk>>`. The chunks in that stream are **plain JS objects** - `useChat` doesn't care where they came from. tRPC subscriptions yield objects. The fit is mechanical.

This package gives you the two pieces:
1. A server-side action that produces correctly-shaped chunks from `streamText`
2. A client-side transport that adapts a subscribe function into the stream `useChat` wants

## Server-side: `createChatAction`

```typescript
import { silkweave } from '@silkweave/core'
import { trpc } from '@silkweave/trpc'
import { createChatAction } from '@silkweave/ai'
import { anthropic } from '@ai-sdk/anthropic'

const ChatAction = createChatAction({
  model: anthropic('claude-sonnet-4-6'),
  system: 'You are a helpful assistant.'
})

await silkweave({ name: 'chat-server', description: 'AI Chat', version: '1.0.0' })
  .adapter(trpc({ host: 'localhost', port: 8080 }))
  .action(ChatAction)
  .start()
```

The action accepts the input shape `useChat` sends through a custom transport (`messages`, `trigger`, `chatId`, `messageId`) and yields `UIMessageChunk`s directly from `streamText().toUIMessageStream()`. Because it's a streaming action with a `chunk` schema, the tRPC adapter registers it as a `.subscription()`.

### Options

| Field | Type | Description |
|---|---|---|
| `model` | `LanguageModel` | The model to drive (e.g. `anthropic('claude-sonnet-4-6')`). Required. |
| `name` | `string` | Action name. Defaults to `'chat'`. |
| `description` | `string` | Action description. |
| `system` | `string` | System prompt. |
| `tools` | `ToolSet` | Tools passed through to `streamText`. |
| `maxOutputTokens` | `number` | Max model output tokens. |
| `temperature` | `number` | Model temperature. |

## Client-side: `silkweaveTransport`

```typescript
import { useChat } from '@ai-sdk/react'
import { silkweaveTransport } from '@silkweave/ai'
import { trpc } from './trpc-client'

const transport = silkweaveTransport(trpc.chat.subscribe)

export function Chat() {
  const { messages, sendMessage, status } = useChat({ transport })
  // ...
}
```

The `subscribe` argument can be the tRPC procedure reference itself - its `(input, callbacks) => { unsubscribe }` shape is what `silkweaveTransport` expects. You can also pass a wrapper if you need to inject auth headers or transform the input before it hits the server.

The subscribe function receives:

```ts
input: {
  messages: UIMessage[]
  trigger: 'submit-message' | 'regenerate-message'
  chatId: string
  messageId: string | undefined
  metadata?: unknown
  body?: Record<string, unknown>
  headers?: Record<string, string>
}

callbacks: {
  onData(chunk: UIMessageChunk): void
  onError(error: unknown): void
  onComplete(): void
}
```

…and must return `{ unsubscribe(): void }`. This shape is compatible with tRPC v11's `client.<procedure>.subscribe(input, callbacks)` callsite.

`abortSignal` from `useChat` is wired automatically - when the user cancels, `unsubscribe()` fires and the underlying tRPC subscription propagates the cancellation back into the Silkweave action's async generator.

### Limitations

- **`reconnectToStream` returns `null`.** Stream resume after disconnect is not supported; if a connection drops mid-stream the consumer must resend. AI SDK's `DefaultChatTransport` has its own resumability infrastructure (stream IDs, chat persistence) - replicating that on top of tRPC would require server-side state we don't manage here.
- **tRPC subscription transport limits apply.** `httpSubscriptionLink` uses SSE which is GET-only; large message arrays serialized as a query parameter will hit URL length limits in long conversations. Use `wsLink` (WebSocket) or configure batching that POSTs.

## See Also

- [Silkweave README](https://github.com/silkweave/silkweave) - Full documentation
- [`@silkweave/core`](https://www.npmjs.com/package/@silkweave/core) - Core library, streaming actions
- [`@silkweave/trpc`](https://www.npmjs.com/package/@silkweave/trpc) - tRPC adapter (subscriptions)
- [Vercel AI SDK - Transport docs](https://ai-sdk.dev/docs/ai-sdk-ui/transport)
- [AI Elements](https://elements.ai-sdk.dev) - prebuilt React components for chat UIs
