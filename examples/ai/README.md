# @silkweave/example-ai

A minimal chat app that demonstrates wiring [Vercel AI SDK](https://ai-sdk.dev/)'s `useChat` to a [Silkweave](https://github.com/silkweave/silkweave) streaming action over tRPC subscriptions - no Data Stream Protocol, no separate `/api/chat` route, fully typed end-to-end.

## What this shows

```
┌────────────────────────────┐         tRPC subscription          ┌────────────────────────────────┐
│  React app (Vite)          │  ◄────────────────────────────────►│  Node server                   │
│  ─ useChat()               │       UIMessageChunk objects       │  ─ silkweave + trpc adapter    │
│  ─ silkweaveTransport()    │                                    │  ─ createChatAction(streamText) │
└────────────────────────────┘                                    └────────────────────────────────┘
```

- **Frontend**: Vite + React 19. Calls `useChat({ transport: silkweaveTransport(...) })`. UI is hand-rolled with Tailwind v4 - you can swap in [`ai-elements`](https://elements.ai-sdk.dev) components without touching the data layer.
- **Backend**: Silkweave with the tRPC adapter on port 8081. A single chat action built with `createChatAction()` from `@silkweave/ai` - it wraps Anthropic's Claude via AI SDK's `streamText` and forwards `toUIMessageStream()` chunks to the action's generator.
- **Wire**: tRPC v11 subscriptions. The custom transport adapts the subscription's callback shape into the `ReadableStream<UIMessageChunk>` `useChat` expects.

## Setup

```bash
# from repo root
pnpm install

# create examples/ai/.env with your key (the server loads it via dotenv)
echo "ANTHROPIC_API_KEY=sk-ant-..." > examples/ai/.env

# run server + Vite together
pnpm -F @silkweave/example-ai dev
```

Then open <http://localhost:5173>. The server runs on `:8081` and Vite proxies `/trpc/*` to it (configured in `vite.config.ts`). Default model is `claude-haiku-4-5` (configurable in `server/server.ts`).

## Project layout

| Path | What it is |
|---|---|
| `server/server.ts` | Silkweave server with the tRPC adapter and the chat action |
| `src/trpc.ts` | tRPC client. Uses `splitLink` so subscriptions go via `httpSubscriptionLink` (SSE) and regular calls via `httpBatchLink` |
| `src/App.tsx` | Chat UI. `useChat` + `silkweaveTransport` - that's the whole integration |
| `src/index.css` | Tailwind v4 base |
| `vite.config.ts` | Vite + React + Tailwind plugin + dev proxy |

## How the integration works

**Server side** - the chat action looks like any other Silkweave streaming action, except the `chunk` schema is `UIMessageChunk` and the `run` generator forwards AI SDK's stream:

```ts
import { createChatAction } from '@silkweave/ai'
import { anthropic } from '@ai-sdk/anthropic'

const ChatAction = createChatAction({
  model: anthropic('claude-haiku-4-5'),
  system: 'You are a helpful assistant.'
})
```

Internally that's roughly:

```ts
chunk: z.custom<UIMessageChunk>(),
run: async function* ({ messages }) {
  const result = streamText({ model, messages: convertToModelMessages(messages) })
  for await (const chunk of result.toUIMessageStream()) {
    yield chunk
  }
}
```

The tRPC adapter sees `isStreamingAction(ChatAction) === true` and registers it as a `.subscription()` automatically.

**Client side** - `silkweaveTransport` is a `ChatTransport` for `useChat` that takes any subscribe-style function and adapts it into a `ReadableStream<UIMessageChunk>`:

```ts
const transport = silkweaveTransport((input, callbacks) =>
  trpc.chat.subscribe(input, callbacks)
)

const { messages, sendMessage } = useChat({ transport })
```

That's it. AI SDK's Data Stream Protocol is bypassed entirely - `useChat` consumes the chunks we hand it directly, with full TypeScript inference from `AppRouter`.

## Caveats

- **No resume after disconnect.** `reconnectToStream` returns `null`. If a tab refreshes mid-stream the in-progress message is lost. AI SDK's `DefaultChatTransport` has stream resumption logic backed by chat persistence - replicating that here would require server-side state. Fine for an example; consider it for production.
- **`httpSubscriptionLink` uses SSE (GET).** Large message arrays become large query strings. For long conversations or production use, switch to `wsLink` (WebSocket).
- **`@silkweave/ai` is intentionally thin.** The two pieces here (`createChatAction`, `silkweaveTransport`) are simple enough that you can copy them into your own app if you want full control.

## Try this

- Add tools to the chat action: `createChatAction({ model, tools: { weather: ... } })`. `useChat` will receive `tool-input-*` / `tool-output-*` chunks; you can render them with the [`ai-elements`](https://elements.ai-sdk.dev/components/tool-input) tool components.
- Replace the hand-rolled UI with official `ai-elements` (`npx ai-elements@latest add conversation message prompt-input`). The data layer doesn't change.
- Swap the model: `openai('gpt-4o')` from `@ai-sdk/openai` - anywhere AI SDK works, this stack works.
