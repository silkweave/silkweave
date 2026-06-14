# @silkweave/core

Core library for [Silkweave](https://github.com/silkweave/silkweave) - the TypeScript toolkit for building MCP servers and CLI tools from a single set of Actions.

## Install

```bash
pnpm add @silkweave/core
```

## What's Inside

This package provides the foundational building blocks that all Silkweave adapters depend on:

- **`silkweave()`** - Fluent builder to wire up adapters and actions
- **`createAction()`** - Define transport-agnostic actions with Zod input/output (or `chunk`, for streaming) schemas
- **Adapter types** - `Adapter`, `AdapterGenerator`, `AdapterFactory` interfaces for building custom adapters
- **Context** - `SilkweaveContext` key-value store with `fork()` for per-adapter/per-request isolation
- **Streaming utilities** - `isStreamingAction()` and `runStreamingAction()` for adapters that need to consume async-generator actions
- **Zod utilities** - `unwrap()` to recursively unwrap Zod wrapper types

## Usage

```typescript
import { silkweave, createAction } from '@silkweave/core'
import z from 'zod/v4'

const GreetAction = createAction({
  name: 'greet',
  description: 'Greet someone by name',
  input: z.object({
    name: z.string().describe('Name to greet')
  }),
  run: async ({ name }, context) => {
    return { message: `Hello, ${name}!` }
  }
})

// Wire up with any adapter
await silkweave({ name: 'my-app', description: 'My App', version: '1.0.0' })
  .adapter(someAdapter)
  .action(GreetAction)
  .start()
```

## API

### `silkweave(options): Silkweave`

| Option | Type | Description |
|--------|------|-------------|
| `name` | `string` | Server/app name |
| `description` | `string` | Human-readable description |
| `version` | `string` | Semantic version |

Returns a builder with `.adapter()`, `.action()`, `.actions()`, `.set()`, and `.start()`.

### `createAction(action): Action`

| Field | Type | Description |
|-------|------|-------------|
| `name` | `string` | Unique action identifier |
| `description` | `string` | Human-readable description |
| `input` | `z.ZodObject` | Zod schema for input validation |
| `output` | `z.ZodObject` | Optional Zod schema for the return type (used by typegen and Fastify OpenAPI). Mutually exclusive with `chunk`. |
| `chunk` | `z.ZodType` | Optional Zod schema for individual chunks yielded by a streaming `run`. Required (and `run` must be an `async function*`) to make this a streaming action. See [Streaming Actions](#streaming-actions). |
| `kind` | `'query' \| 'mutation'` | Optional. Defaults to `'mutation'`. Marks the action as a cacheable read for tRPC. |
| `method` | `'GET' \| 'POST' \| 'PUT' \| 'DELETE'` | Optional REST verb for `@silkweave/fastify` / `@silkweave/nestjs` `rest`. Defaults to `POST`, or `GET` when `kind: 'query'`. See [REST routing](#rest-routing). |
| `path` | `string` | Optional REST route template, may contain `:param` placeholders (e.g. `'spaces/:spaceId/users'`). Each placeholder must be a key of `input`. See [REST routing](#rest-routing). |
| `queryParams` | `(keyof I)[]` | Optional input fields read from the URL query string instead of the body (e.g. `['offset', 'limit']`). See [REST routing](#rest-routing). |
| `args` | `(keyof I)[]` | Fields to expose as CLI positional arguments |
| `isEnabled` | `(context) => boolean` | Gate action availability per adapter |
| `run` | `(input, context) => Promise<O>` *or* `async function*(input, context): AsyncGenerator<Chunk>` | The action implementation. Use a regular `async` function for buffered request/response; use an `async function*` and declare `chunk` to stream. |
| `toolResult` | `(response, context) => CallToolResult \| undefined` | Custom MCP result formatting (optional). For streaming actions, `response` is the buffered array of chunks (used when the client did not request streaming). |

### Streaming Actions

An action with a `chunk` schema and an `async function*` `run` is detected as **streaming** by `isStreamingAction()`. Adapters branch on this at registration time and deliver chunks differently per transport - see the [Silkweave README's Streaming Actions section](https://github.com/silkweave/silkweave#streaming-actions) for the per-adapter wire-format table and the important caveat about how MCP clients surface (or don't surface) chunks to the model.

```typescript
import { createAction } from '@silkweave/core'
import z from 'zod/v4'

export const GenerateMessagesAction = createAction({
  name: 'generate-messages',
  description: 'Stream a series of generated messages',
  input: z.object({ count: z.number().int().min(1).max(50) }),
  chunk: z.object({ index: z.number().int(), text: z.string() }),
  run: async function* ({ count }, { logger }) {
    for (let i = 0; i < count; i += 1) {
      yield { index: i, text: `Message ${i + 1}` }
    }
  }
})
```

Two utilities are exported for adapter authors:

| Function | Description |
|----------|-------------|
| `isStreamingAction(action)` | Returns `true` when `action.run.constructor.name === 'AsyncGeneratorFunction'`. |
| `runStreamingAction(action, input, context, onChunk?)` | Drives the generator, awaiting `onChunk` per yielded chunk so transport-level backpressure (SSE drain, MCP notification ack) flows back into the action. Returns the buffered array of all chunks; pass no `onChunk` to use this as a buffered fallback. |

### Adapter Interfaces

```typescript
interface Adapter {
  context: SilkweaveContext
  start(actions: Action[]): Promise<void>
  stop(): Promise<void>
}

type AdapterGenerator = (options: SilkweaveOptions, baseContext: SilkweaveContext) => Adapter
type AdapterFactory<T = void> = (options: T) => AdapterGenerator
```

## See Also

- [Silkweave README](https://github.com/silkweave/silkweave) - Full documentation
- [`@silkweave/mcp`](https://www.npmjs.com/package/@silkweave/mcp) - MCP stdio and HTTP adapters
- [`@silkweave/fastify`](https://www.npmjs.com/package/@silkweave/fastify) - Fastify REST adapter
- [`@silkweave/cli`](https://www.npmjs.com/package/@silkweave/cli) - CLI adapter
- [`@silkweave/vercel`](https://www.npmjs.com/package/@silkweave/vercel) - Vercel serverless adapter
- [`@silkweave/typegen`](https://www.npmjs.com/package/@silkweave/typegen) - Build-time type generation
