# Silkweave

**Write your logic once. Run it everywhere.**

Silkweave is a TypeScript toolkit that lets you define application logic as portable **Actions** and instantly expose them through any combination of transports - MCP servers (stdio and HTTP), REST APIs with auto-generated OpenAPI docs, and fully-featured CLIs. No glue code required.

```
                     ┌─────────────────────┐
                     │       Action         │
                     │  name + zod schema   │
                     │  + async run()       │
                     └──────────┬──────────┘
                                │
         ┌──────────────┬───────┼───────┬──────────────┐
         │              │       │       │              │
  ┌──────▼──────┐ ┌─────▼─────┐ │ ┌─────▼──────┐ ┌────▼─────┐
  │ MCP (stdio) │ │   Fastify │ │ │    CLI     │ │   Edge   │
  │ MCP (http)  │ │  REST API │ │ │ commander  │ │serverless│
  │             │ │ + Swagger │ │ │  + clack   │ │  MCP     │
  └─────────────┘ └───────────┘ │ └────────────┘ └──────────┘
                                │
```

---

## Table of Contents

- [Why Silkweave](#why-silkweave)
- [Packages](#packages)
- [Quick Start](#quick-start)
- [Core Concepts](#core-concepts)
  - [Actions](#actions)
  - [Adapters](#adapters)
  - [The Silkweave Builder](#the-silkweave-builder)
- [Adapters in Depth](#adapters-in-depth)
  - [MCP Stdio](#mcp-stdio)
  - [MCP Streamable HTTP](#mcp-streamable-http)
  - [Fastify REST API](#fastify-rest-api)
  - [CLI](#cli)
  - [Edge Adapter](#edge-adapter)
- [Logging and Progress](#logging-and-progress)
- [Streaming Actions](#streaming-actions)
- [Plug into Vercel AI SDK](#plug-into-vercel-ai-sdk)
- [Smart Tool Results](#smart-tool-results)
- [Advanced Patterns](#advanced-patterns)
  - [Multiple Adapters Simultaneously](#multiple-adapters-simultaneously)
  - [CLI Arguments vs Options](#cli-arguments-vs-options)
  - [Complex Input Types](#complex-input-types)
- [MCP Client Configuration](#mcp-client-configuration)
- [API Reference](#api-reference)
- [Development](#development)

---

## Why Silkweave

Building an MCP server usually means wiring up transports, registering tools, serializing responses, and handling errors - for every single tool. If you also want a CLI or REST API for the same logic, you're writing it all again.

Silkweave eliminates this duplication. You define an **Action** - a name, a Zod schema, and an async function - and Silkweave handles the rest:

- **MCP adapters** register your actions as MCP tools with proper notifications, progress reporting, and error handling
- **Fastify adapter** generates a REST API with full OpenAPI/Swagger documentation derived from your Zod schemas
- **CLI adapter** builds a complete command-line interface with argument parsing, option flags, and beautiful terminal output via clack

Your action doesn't know or care which transport is running it.

---

## Packages

Silkweave is organized as a monorepo with modular packages. Install only what you need:

| Package | npm | Description |
|---------|-----|-------------|
| `@silkweave/core` | [![npm](https://img.shields.io/npm/v/@silkweave/core)](https://www.npmjs.com/package/@silkweave/core) | Core library - actions, adapters, builder, context, logger, utilities |
| `@silkweave/mcp` | [![npm](https://img.shields.io/npm/v/@silkweave/mcp)](https://www.npmjs.com/package/@silkweave/mcp) | MCP adapters - stdio, streamable HTTP, CLI proxy |
| `@silkweave/cli` | [![npm](https://img.shields.io/npm/v/@silkweave/cli)](https://www.npmjs.com/package/@silkweave/cli) | CLI adapter - commander + clack terminal UI |
| `@silkweave/fastify` | [![npm](https://img.shields.io/npm/v/@silkweave/fastify)](https://www.npmjs.com/package/@silkweave/fastify) | Fastify REST adapter - auto-generated OpenAPI/Swagger docs |
| `@silkweave/edge` | [![npm](https://img.shields.io/npm/v/@silkweave/edge)](https://www.npmjs.com/package/@silkweave/edge) | Edge / serverless adapter - stateless MCP over Web Standard Streamable HTTP |
| `@silkweave/ai` | [![npm](https://img.shields.io/npm/v/@silkweave/ai)](https://www.npmjs.com/package/@silkweave/ai) | Vercel AI SDK bridge - `createChatAction()` + `silkweaveTransport()` for `useChat` over tRPC subscriptions |
| `@silkweave/logger` | [![npm](https://img.shields.io/npm/v/@silkweave/logger)](https://www.npmjs.com/package/@silkweave/logger) | Logging utilities - pino, clack, and MCP notification support |

**`@silkweave/core`** is always required. Then add the adapter packages for the transports you need:

```bash
# MCP server (stdio or HTTP)
pnpm add @silkweave/core @silkweave/mcp

# REST API with Swagger
pnpm add @silkweave/core @silkweave/fastify

# CLI tool
pnpm add @silkweave/core @silkweave/cli

# Vercel serverless MCP
pnpm add @silkweave/core @silkweave/edge

# Vercel AI SDK chat (useChat over tRPC subscriptions)
pnpm add @silkweave/core @silkweave/trpc @silkweave/ai ai @ai-sdk/anthropic

# All of the above
pnpm add @silkweave/core @silkweave/mcp @silkweave/cli @silkweave/fastify @silkweave/edge @silkweave/ai
```

---

## Quick Start

```bash
pnpm add @silkweave/core @silkweave/mcp
```

Create an action:

```typescript
// actions/greet.ts
import z from 'zod/v4'
import { createAction } from '@silkweave/core'

export const GreetAction = createAction({
  name: 'greet',
  description: 'Greet someone by name',
  input: z.object({
    name: z.string().describe('The name to greet'),
    enthusiastic: z.boolean().describe('Add excitement').default(false)
  }),
  run: async ({ name, enthusiastic }, { logger }) => {
    const greeting = enthusiastic ? `HELLO, ${name.toUpperCase()}!!!` : `Hello, ${name}.`
    logger.info(greeting)
    return { greeting }
  }
})
```

Serve it as an MCP server:

```typescript
// server.ts
import { silkweave } from '@silkweave/core'
import { stdio } from '@silkweave/mcp'
import { GreetAction } from './actions/greet.js'

await silkweave({ name: 'my-server', description: 'My MCP Server', version: '1.0.0' })
  .adapter(stdio())
  .action(GreetAction)
  .start()
```

That's it. Your action is now an MCP tool called `Greet` that any MCP client (Claude Desktop, Cursor, Claude Code, etc.) can discover and invoke.

---

## Core Concepts

### Actions

An Action is the fundamental unit of logic in Silkweave. It is completely transport-agnostic.

```typescript
import z from 'zod/v4'
import { createAction } from '@silkweave/core'

export const SearchAction = createAction({
  name: 'search',
  description: 'Search documents by query',
  input: z.object({
    query: z.string().describe('Search query'),
    limit: z.number().int().min(1).max(100).describe('Max results').default(10),
    includeArchived: z.boolean().describe('Include archived documents').default(false)
  }),
  run: async ({ query, limit, includeArchived }, { logger }) => {
    logger.info(`Searching for: ${query}`)
    // ... your logic here
    const results = await performSearch(query, { limit, includeArchived })
    return { results, count: results.length }
  }
})
```

**`createAction`** accepts an object with:

| Field | Type | Description |
|-------|------|-------------|
| `name` | `string` | Unique identifier. Adapters transform this automatically (PascalCase for MCP tools, kebab-case for CLI commands, as-is for REST routes). |
| `description` | `string` | Human-readable description. Shown in MCP tool listings, CLI help, and Swagger docs. |
| `input` | `z.ZodObject` | A Zod object schema defining the input. `.describe()` on each field provides per-field documentation across all adapters. |
| `args` | `(keyof I)[]` | *(Optional)* Fields to expose as positional CLI arguments instead of `--options`. Only relevant for the CLI adapter. |
| `run` | `(input, context) => Promise<O>` | The implementation. Receives validated input and an `SilkweaveContext` with a `logger`. Returns any object - adapters handle serialization. |
| `toolResult` | `(response, context) => CallToolResult \| undefined` | *(Optional)* Custom MCP result formatting. Return `undefined` to fall through to the default `smartToolResult` behavior. See [Smart Tool Results](#smart-tool-results). |

### Adapters

Adapters are the bridge between your actions and the outside world. Each adapter is a factory function that takes configuration and returns a generator compatible with the Silkweave builder.

```typescript
import { stdio, http } from '@silkweave/mcp'
import { fastify } from '@silkweave/fastify'
import { cli } from '@silkweave/cli'

// No config needed
stdio()

// Host and port required
http({ host: 'localhost', port: 8080 })

// Full Fastify options pass-through
fastify({ host: 'localhost', port: 8080, logger: true })

// No config needed
cli()
```

The adapter lifecycle:

1. **Factory** - `stdio()` / `http({ ... })` / etc. captures configuration
2. **Generator** - Silkweave calls the factory result with `{ name, description, version }` to produce an `Adapter`
3. **Start** - `adapter.start(actions)` registers all actions and begins listening
4. **Stop** - `adapter.stop()` tears down gracefully

### The Silkweave Builder

The builder provides a fluent, chainable API:

```typescript
import { silkweave } from '@silkweave/core'
import { stdio, http } from '@silkweave/mcp'

const app = silkweave({
  name: 'my-toolkit',
  description: 'A collection of useful tools',
  version: '2.1.0'
})

app
  .adapter(stdio())              // Add an adapter
  .adapter(http({ ... }))        // Add another - they run in parallel
  .action(SearchAction)          // Mount an action
  .action(GreetAction)           // Mount another

await app.start()                // Start all adapters concurrently
```

`.adapter()` and `.action()` return the same instance, so you can chain freely. `.start()` launches all adapters in parallel via `Promise.all`.

---

## Adapters in Depth

### MCP Stdio

The standard MCP transport for local tool servers. Communicates over stdin/stdout using the MCP protocol.

```typescript
import { silkweave } from '@silkweave/core'
import { stdio } from '@silkweave/mcp'

await silkweave({ name: 'my-tools', description: 'My Tools', version: '1.0.0' })
  .adapter(stdio())
  .action(MyAction)
  .start()
```

**How actions become MCP tools:**

| Action property | MCP tool property |
|-----------------|-------------------|
| `name: 'searchDocs'` | Tool name: `SearchDocs` (PascalCase) |
| `description` | Tool description |
| `input` (Zod schema) | `inputSchema` (JSON Schema via Zod) |
| Return value | `CallToolResult` via `smartToolResult` or custom `toolResult` hook |
| Thrown errors | Structured error response via `handleToolError` |

By default, MCP adapters use `smartToolResult()` to format return values. Responses ≤ 4096 chars are returned as inline JSON, while larger payloads are automatically split into a text summary + base64 embedded resource to reduce LLM context bloat. Actions can override this with a custom [`toolResult` hook](#smart-tool-results).

MCP logging notifications are wired automatically - `logger.info("message")` in your action sends a `notifications/message` to the MCP client. Progress reporting works via `logger.progress()` when the client provides a progress token.

**Claude Desktop / Claude Code configuration:**

```json
{
  "mcpServers": {
    "my-tools": {
      "command": "node",
      "args": ["path/to/server.js"]
    }
  }
}
```

### MCP Streamable HTTP

A session-based MCP transport over HTTP with Server-Sent Events (SSE) for streaming. Supports multiple concurrent sessions, resumability via `Last-Event-ID`, and session termination.

```typescript
import { silkweave } from '@silkweave/core'
import { http } from '@silkweave/mcp'

await silkweave({ name: 'my-tools', description: 'My Tools', version: '1.0.0' })
  .adapter(http({
    host: 'localhost',
    port: 8080,
    allowedHosts: ['localhost']
  }))
  .action(MyAction)
  .start()
```

**Endpoints exposed:**

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/mcp` | Initialize session or invoke tools |
| `GET` | `/mcp` | Establish SSE stream for a session |
| `DELETE` | `/mcp` | Terminate a session |

The adapter manages session lifecycle automatically - each new `initialize` request creates a new `StreamableHTTPServerTransport` with a UUID session ID. Sessions are cleaned up when the transport closes.

CORS is configured out of the box, exposing MCP-specific headers (`Mcp-Session-Id`, `Mcp-Protocol-Version`, `Last-Event-Id`).

**`HttpAdapterOptions`:**

| Option | Type | Description |
|--------|------|-------------|
| `host` | `string` | Bind address |
| `port` | `number` | Listen port |
| `allowedHosts` | `string[]` | Hosts allowed to connect (passed to Express MCP app) |

### Fastify REST API

Turns your actions into a REST API with auto-generated OpenAPI documentation and an interactive Swagger UI powered by Scalar.

```typescript
import { silkweave } from '@silkweave/core'
import { fastify } from '@silkweave/fastify'

await silkweave({ name: 'my-api', description: 'My REST API', version: '1.0.0' })
  .adapter(fastify({
    host: 'localhost',
    port: 8080,
    logger: true
  }))
  .action(SearchAction)
  .action(GreetAction)
  .start()
```

**Route mapping:**

Each action becomes a `POST /{action.name}` route. The Zod schema is converted to JSON Schema for request body validation and OpenAPI documentation.

| Action | Route | Body |
|--------|-------|------|
| `name: 'search'` | `POST /search` | `{ "query": "...", "limit": 10 }` |
| `name: 'greet'` | `POST /greet` | `{ "name": "World" }` |

Visit `http://localhost:8080/` for the interactive Scalar API reference with try-it-out functionality.

**`FastifyAdapterOptions`:**

Extends Fastify's native `FastifyHttpOptions`, so any Fastify config is supported:

```typescript
fastify({
  host: 'localhost',
  port: 8080,
  logger: {
    level: 'debug',
    transport: { target: 'pino-pretty' }
  },
  connectionTimeout: 30000
})
```

### CLI

Transforms your actions into a complete command-line application with help text, option parsing, and styled terminal output via clack.

```typescript
import { silkweave } from '@silkweave/core'
import { cli } from '@silkweave/cli'

await silkweave({ name: 'mytool', description: 'My CLI Tool', version: '1.0.0' })
  .adapter(cli())
  .action(GreetAction)
  .action(SearchAction)
  .start()
```

**How Zod types map to CLI options:**

| Zod Type | CLI Representation |
|----------|-------------------|
| `z.string()` | `--option-name <string>` |
| `z.number()` | `--option-name <number>` |
| `z.boolean()` | `--option-name` / `--no-option-name` |
| `z.record()` | `--option-name <json>` |
| `.default(value)` | Sets the default in help text |
| `.describe('...')` | Sets the option description |

Field names are automatically converted to `kebab-case` for flags. Action names become `kebab-case` subcommands.

**Example output:**

```
$ mytool greet --name "World" --enthusiastic
◇ mytool - greet
ℹ HELLO, WORLD!!!
```

### Edge Adapter

Deploy your actions as a stateless MCP server on Vercel. Each request creates a fresh server instance - no sessions, no persistent connections, fully compatible with serverless constraints.

```typescript
// api/mcp.ts (edge / serverless function)
import { silkweave } from '@silkweave/core'
import { edge } from '@silkweave/edge'
import { SearchAction } from '../actions/search.js'

const { adapter, handler } = edge()

await silkweave({ name: 'my-tools', description: 'My Tools', version: '1.0.0' })
  .adapter(adapter)
  .action(SearchAction)
  .start()

export default { fetch: handler }
```

The `edge()` function returns a compound object - `adapter` wires into the Silkweave builder, while `handler`/`GET`/`POST`/`DELETE` are the request handler for your Vercel route.

**For Next.js App Router** (`app/api/mcp/route.ts`):

```typescript
const { adapter, GET, POST, DELETE } = edge()

await silkweave({ name: 'my-tools', description: 'My Tools', version: '1.0.0' })
  .adapter(adapter)
  .action(SearchAction)
  .start()

export { GET, POST, DELETE }
```

**How it works:**

- Uses `WebStandardStreamableHTTPServerTransport` from the MCP SDK in stateless mode (`sessionIdGenerator: undefined`)
- Each request creates a fresh `McpServer` + transport, registers tools, handles the request, and returns a Web Standard `Response`
- Logging goes to `process.stderr` (Vercel log drain) and MCP client notifications
- No CORS handling - use Next.js middleware or `vercel.json` headers

**`EdgeAdapterOptions`:**

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `enableJsonResponse` | `boolean` | `false` | Return JSON instead of SSE streams |

---

## Logging and Progress

Every action receives a `context.logger` with eight severity levels plus a progress reporter:

```typescript
run: async (input, { logger }) => {
  logger.debug('Starting operation...')
  logger.info('Processing item')
  logger.warning('Rate limit approaching')
  logger.error('Failed to connect')

  // Progress reporting (renders as MCP progress notifications,
  // Fastify trace logs, or console output depending on adapter)
  for (let i = 1; i <= total; i++) {
    logger.progress({
      progress: i,
      total: total,
      message: `Processing item ${i} of ${total}`
    })
    await processItem(i)
  }

  return { processed: total }
}
```

**How logging is handled per adapter:**

| Level | MCP (stdio/http) | Fastify | CLI |
|-------|-------------------|---------|-----|
| `debug` | `notifications/message` | `logger.debug()` | `log.message()` |
| `info` | `notifications/message` | `logger.info()` | `log.info()` |
| `warning` | `notifications/message` | `logger.warn()` | `log.warn()` |
| `error` | `notifications/message` | `logger.error()` | `log.error()` |
| `critical` | `notifications/message` | `logger.fatal()` | `log.error()` |
| `progress` | `notifications/progress` | `logger.trace()` | `console.info()` |

`logger.progress()` is for **numeric progress reporting** (e.g. "step 3 of 10") inside an otherwise-buffered action. For per-chunk **data streaming**, define the action as a streaming action - see the next section.

---

## Streaming Actions

A streaming action returns multiple chunks over the lifetime of a single invocation instead of one buffered result. Declare a `chunk` Zod schema and write `run` as an `async function*`:

```typescript
import { createAction } from '@silkweave/core'
import z from 'zod/v4'

export const GenerateMessagesAction = createAction({
  name: 'generate-messages',
  description: 'Stream a series of generated messages about a topic',
  input: z.object({
    topic: z.string().describe('The topic to generate messages about'),
    count: z.number().int().min(1).max(50).default(5)
  }),
  chunk: z.object({
    index: z.number().int(),
    text: z.string()
  }),
  run: async function* ({ topic, count }, { logger }) {
    logger.info(`Streaming ${count} messages about "${topic}"`)
    for (let i = 0; i < count; i += 1) {
      yield { index: i, text: `Message ${i + 1} about ${topic}` }
    }
  }
})
```

Adapters detect streaming actions via `isStreamingAction()` at registration time and switch to per-chunk wire delivery. The action itself is unchanged across transports - the same generator runs whether it's reached over MCP, HTTP, tRPC, or the CLI.

### How each adapter delivers chunks

| Adapter | Wire format | How a client opts in | Buffered fallback |
|---------|-------------|---------------------|-------------------|
| **MCP stdio** (`@silkweave/mcp`) | `notifications/progress` - one notification per chunk, with the JSON-stringified chunk in the `message` field and a 1-based `progress` counter | Client sends `_meta.progressToken` in the tool call (MCP SDK does this automatically when the host subscribes) | Action runs to completion; chunks are buffered and returned as the final `CallToolResult` |
| **MCP HTTP** (`@silkweave/mcp`) | Same - `notifications/progress` carried on the session's SSE stream | Same - `_meta.progressToken` | Same |
| **MCP Edge** (`@silkweave/edge`) | Same - `notifications/progress` over Streamable HTTP | Same | Same |
| **Fastify REST** (`@silkweave/fastify`) | `text/event-stream` (SSE: `data: <json>\n\n`, terminated by `event: done`) **or** `application/x-ndjson` (one JSON chunk per line) | `Accept: text/event-stream` or `Accept: application/x-ndjson` | `200 OK` with the buffered chunk array as JSON |
| **tRPC** (`@silkweave/trpc`) | Action is registered as a tRPC **`.subscription()`** whose async generator yields chunks directly | Streaming action ⇒ always a subscription, regardless of `kind` | n/a - the consumer iterates the subscription |
| **CLI** (`@silkweave/cli`) | NDJSON on stdout (one JSON chunk per line, backpressure-aware via `stdout.write` + `drain`) | Streaming action ⇒ always streamed | n/a |

Backpressure is wired end-to-end: each adapter awaits the wire-level write (SSE drain, stdout drain, MCP notification ack) before pulling the next value from your generator. Slow consumers throttle the action rather than buffering chunks unboundedly in memory.

### What streaming means for AI/MCP clients

This is the part that most often surprises people, and it's worth being explicit about.

**On the wire**, MCP `notifications/progress` is standard protocol - your server emits one notification per chunk, and any compliant MCP client receives them as they're produced.

**What the client does with them is up to the client.** Most LLM-driven MCP hosts today (Claude Code, Cursor, generic chat UIs) consume progress notifications for **UI rendering** - spinners, status text, progress bars in the terminal or chat - and **not** as incremental data fed into the model's context. From the model's perspective, an MCP tool call is still atomic: invoke → wait → single aggregated result.

So the chunks reach the wire correctly; **in-flight model visibility depends on host behavior**, not on your server. Today, you can rely on chunks being:

- Delivered to the host process
- Surfaced as UI affordances (spinner text, progress bars) - visible to the human user
- Useful for resumability and cancellation (`Last-Event-ID`, abort signals)

You generally **cannot** rely on the host feeding chunks into the model's context as they arrive. The model will see the buffered result when the call returns.

**If you need per-chunk model visibility today**, prefer transports where streaming is part of the consumer contract rather than a side channel:

- **Fastify SSE/NDJSON** - your consumer (a frontend, a worker, another agent) iterates chunks directly
- **tRPC subscriptions** - typed async-iterable client-side; trivial to fan out chunk-by-chunk
- **CLI NDJSON** - pipe `your-tool generate-messages | jq` and process each line

These flip the architecture so the consumer drives chunk handling, which keeps the model in the loop without depending on host-specific MCP behavior.

---

## Plug into Vercel AI SDK

The [`@silkweave/ai`](https://www.npmjs.com/package/@silkweave/ai) package bridges Vercel AI SDK's `useChat` hook to a Silkweave streaming action over a tRPC subscription. No `/api/chat` route, no AI SDK Data Stream Protocol - `useChat` consumes plain `UIMessageChunk` objects directly from your tRPC client.

```bash
pnpm add @silkweave/ai @silkweave/core @silkweave/trpc ai @ai-sdk/anthropic
```

**Server** - `createChatAction` wraps `streamText` in a Silkweave streaming action whose `chunk` schema is `UIMessageChunk`. The tRPC adapter sees it's streaming and registers it as a `.subscription()` automatically:

```typescript
import { silkweave } from '@silkweave/core'
import { trpc, type InferTrpcRouter } from '@silkweave/trpc'
import { createChatAction } from '@silkweave/ai'
import { anthropic } from '@ai-sdk/anthropic'

const ChatAction = createChatAction({
  model: anthropic('claude-haiku-4-5'),
  system: 'You are a helpful assistant.'
})

const server = silkweave({ name: 'chat', description: 'AI Chat', version: '1.0.0' })
  .adapter(trpc({ port: 8081 }))
  .action(ChatAction)

export type AppRouter = InferTrpcRouter<typeof server>

await server.start()
```

**Client** - `silkweaveTransport` is a custom `ChatTransport` for `useChat` that wraps any subscribe-style function into the `ReadableStream<UIMessageChunk>` the hook expects:

```typescript
import { useChat } from '@ai-sdk/react'
import { silkweaveTransport } from '@silkweave/ai'
import { trpc } from './trpc-client'

const transport = silkweaveTransport(trpc.chat.subscribe)

export function Chat() {
  const { messages, sendMessage } = useChat({ transport })
  // ... your UI; ai-elements components work out of the box
}
```

That's the entire integration. Type safety flows from `AppRouter` through `useChat`; AI SDK's frontend hook is none the wiser that it's not talking to a `DefaultChatTransport` HTTP endpoint.

**Caveats:**
- `reconnectToStream` returns `null` - no stream resume after disconnect. Fine for most cases; production chat with persistence would need server-side stream replay
- `httpSubscriptionLink` uses SSE (GET), so large message arrays serialized into the query string will hit URL length limits. Switch to `wsLink` (WebSocket) for production

See [`examples/ai/`](../../examples/ai) in the repo for a complete Vite + React + Tailwind chat app.

---

## Smart Tool Results

MCP adapters (stdio, HTTP, and Edge) use `smartToolResult()` by default to format action return values. This is a server-side best practice for managing LLM context bloat:

- **Small responses** (≤ 4096 chars): returned as inline `TextContent` JSON
- **Large responses** (> 4096 chars): split into a short text summary + a base64 **embedded resource**, keeping the LLM's context window lean while preserving full data access

Some MCP clients (e.g. VS Code since December 2025) handle this client-side for all tool calls, but most clients don't. `smartToolResult` ensures good behavior regardless of client capabilities.

### Custom `toolResult` Hook

Actions can override the default formatting by defining a `toolResult` hook:

```typescript
import { createAction } from '@silkweave/core'
import { smartToolResult } from '@silkweave/mcp'
import z from 'zod/v4'

export const UserListAction = createAction({
  name: 'user-list',
  description: 'Return a list of users',
  input: z.object({
    format: z.enum(['full', 'summary']).default('summary')
  }),
  run: async ({ format }, context) => {
    context.set('format', format)
    return await fetchUsers()
  },
  toolResult: (users, context) => {
    if (context.get('format') === 'full') {
      return smartToolResult(users)  // Use default smart splitting
    }
    // Return a lean summary as text + full data as embedded resource
    const summary = users.map(({ id, name }) => ({ id, name }))
    return {
      content: [
        { type: 'text', text: JSON.stringify(summary) },
        { type: 'resource', resource: {
          uri: 'mcp://my-app/users.json',
          mimeType: 'application/json',
          blob: Buffer.from(JSON.stringify(users)).toString('base64')
        }}
      ]
    }
  }
})
```

Return `undefined` from `toolResult` to fall through to the default `smartToolResult` behavior. The hook only affects MCP adapters. CLI and Fastify adapters handle serialization independently.

### MCP Result Utilities

All result utilities are exported from `@silkweave/mcp`:

| Function | Description |
|----------|-------------|
| `smartToolResult(data)` | Default formatter with automatic embedded resource splitting at 4096 chars |
| `jsonToolResult(data, isError?)` | Simple inline `TextContent` JSON (no splitting) |
| `errorToolResult(error)` | Format a `SilkweaveError` as an error result |
| `handleToolError(error)` | Catch-all error handler used by all MCP adapters |

---

## Advanced Patterns

### Multiple Adapters Simultaneously

Run an MCP server and a REST API from the same set of actions:

```typescript
import { silkweave } from '@silkweave/core'
import { stdio } from '@silkweave/mcp'
import { fastify } from '@silkweave/fastify'

await silkweave({ name: 'my-platform', description: 'Multi-transport', version: '1.0.0' })
  .adapter(stdio())
  .adapter(fastify({ host: 'localhost', port: 8080, logger: true }))
  .action(SearchAction)
  .action(GreetAction)
  .action(AnalyzeAction)
  .start()
```

All adapters start concurrently. The MCP stdio server communicates over stdin/stdout while Fastify listens on port 8080 - each serving the exact same actions.

### CLI Arguments vs Options

By default, all Zod fields become CLI `--options`. Use the `args` property to promote fields to positional arguments:

```typescript
export const DeployAction = createAction({
  name: 'deploy',
  description: 'Deploy to an environment',
  input: z.object({
    environment: z.string().describe('Target environment'),
    tag: z.string().describe('Release tag'),
    dryRun: z.boolean().describe('Simulate without deploying').default(false)
  }),
  args: ['environment', 'tag'],
  run: async ({ environment, tag, dryRun }, { logger }) => {
    logger.info(`Deploying ${tag} to ${environment}${dryRun ? ' (dry run)' : ''}`)
    // ...
    return { deployed: !dryRun }
  }
})
```

```
$ mytool deploy production v2.1.0 --dry-run
◇ mytool - deploy
ℹ Deploying v2.1.0 to production (dry run)
```

Fields listed in `args` become positional arguments in the CLI. All other fields remain as `--options`. The `args` property has no effect on MCP or REST adapters - they always receive all fields as a single input object.

### Complex Input Types

Zod's full expressiveness is available for input schemas:

```typescript
export const ImportAction = createAction({
  name: 'import',
  description: 'Import data from a source',
  input: z.object({
    source: z.string().describe('Data source URL'),
    format: z.string().describe('File format').default('json'),
    batchSize: z.number().int().min(1).max(10000).describe('Records per batch').default(500),
    tags: z.record(z.string()).describe('Key-value metadata tags').optional(),
    overwrite: z.boolean().describe('Overwrite existing records').default(false)
  }),
  run: async (input, { logger }) => {
    logger.info(`Importing from ${input.source} in ${input.format} format`)
    logger.info(`Batch size: ${input.batchSize}, overwrite: ${input.overwrite}`)
    if (input.tags) {
      logger.debug(`Tags: ${JSON.stringify(input.tags)}`)
    }
    // ...
    return { imported: 1500 }
  }
})
```

In MCP, this becomes a tool with a full JSON Schema. In the CLI, `tags` becomes `--tags <json>` accepting a JSON string. In Fastify, it's a documented POST body.

---

## MCP Client Configuration

### Claude Desktop

Add to your Claude Desktop config (`~/Library/Application Support/Claude/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "my-tools": {
      "command": "node",
      "args": ["/absolute/path/to/server.js"]
    }
  }
}
```

### Claude Code

Add to `.mcp.json` in your project root:

```json
{
  "mcpServers": {
    "my-tools": {
      "command": "pnpm",
      "args": ["tsx", "server.ts"]
    }
  }
}
```

### MCP Inspector

For debugging with the MCP Inspector:

```json
{
  "mcpServers": {
    "my-tools": {
      "command": "pnpm",
      "args": ["tsx", "server.ts"]
    }
  }
}
```

```bash
npx @modelcontextprotocol/inspector --config .mcp.json --server my-tools
```

### HTTP Transport

For the streamable HTTP adapter, point your client at the `/mcp` endpoint:

```
http://localhost:8080/mcp
```

---

## API Reference

### `silkweave(options)`

Creates a new Silkweave builder instance.

```typescript
import { silkweave } from '@silkweave/core'

function silkweave(options: SilkweaveOptions): Silkweave

interface SilkweaveOptions {
  name: string          // Server/app name
  description: string   // Human-readable description
  version: string       // Semantic version
}

interface Silkweave {
  adapter(generator: AdapterGenerator): Silkweave  // Add an adapter
  action(action: Action): Silkweave                // Mount an action
  actions(actions: Action[]): Silkweave            // Mount multiple actions
  start(): Promise<Silkweave>                      // Start all adapters
}
```

### `createAction(action)`

Type-safe action factory. Returns the action object as-is with full type inference.

```typescript
import { createAction } from '@silkweave/core'

function createAction<I extends object, O extends object>(
  action: Action<I, O>
): Action<I, O>

interface Action<I, O> {
  name: string
  description: string
  input: z.ZodType<I> & { shape: Record<string, z.ZodTypeAny> }
  args?: (keyof I)[]
  isEnabled?: (context: SilkweaveContext) => boolean
  run: (input: I, context: SilkweaveContext) => Promise<O>
  toolResult?: (response: O, context: SilkweaveContext) => CallToolResult | undefined
}
```

### `Logger`

```typescript
interface Logger {
  debug: (data: unknown) => void
  info: (data: unknown) => void
  notice: (data: unknown) => void
  warning: (data: unknown) => void
  error: (data: unknown) => void
  critical: (data: unknown) => void
  alert: (data: unknown) => void
  emergency: (data: unknown) => void
  progress: (options: ProgressOptions) => void
}

interface ProgressOptions {
  progress: number
  total?: number
  message?: string
}
```

### Adapter Factories

```typescript
// MCP over stdin/stdout - from @silkweave/mcp
import { stdio } from '@silkweave/mcp'
function stdio(): AdapterFactory

// MCP Streamable HTTP - from @silkweave/mcp
import { http } from '@silkweave/mcp'
function http(options: HttpAdapterOptions): AdapterFactory
interface HttpAdapterOptions {
  host: string
  port: number
  // ...plus CreateMcpExpressAppOptions (e.g., allowedHosts)
}

// Fastify REST API with Swagger - from @silkweave/fastify
import { fastify } from '@silkweave/fastify'
function fastify(options: FastifyAdapterOptions): AdapterFactory
interface FastifyAdapterOptions {
  host?: string
  port?: number
  // ...plus all FastifyHttpOptions (logger, connectionTimeout, etc.)
}

// CLI via commander + clack - from @silkweave/cli
import { cli } from '@silkweave/cli'
function cli(): AdapterFactory

// Edge / serverless - from @silkweave/edge
import { edge } from '@silkweave/edge'
function edge(options?: EdgeAdapterOptions): EdgeAdapter
interface EdgeAdapterOptions {
  enableJsonResponse?: boolean
}
interface EdgeAdapter {
  adapter: AdapterGenerator          // Pass to silkweave().adapter()
  handler: (req: Request) => Promise<Response>
  GET: (req: Request) => Promise<Response>
  POST: (req: Request) => Promise<Response>
  DELETE: (req: Request) => Promise<Response>
}
```

---

## Development

```bash
# Install dependencies
pnpm install

# Build all packages
pnpm build

# Lint + typecheck all packages
pnpm check

# Run example servers
pnpm -F @silkweave/example-mcp stdio       # MCP stdio server
pnpm -F @silkweave/example-mcp http        # MCP streamable HTTP server on :8080
pnpm -F @silkweave/example-fastify dev     # Fastify REST API with Swagger on :8080
pnpm -F @silkweave/example-cli dev         # CLI mode
```

Requires Node.js >= 18.

---

## License

MIT
