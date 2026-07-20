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
| `output` | `z.ZodObject` | Optional Zod schema for the return type (used by typegen, Fastify OpenAPI, and as the MCP `outputSchema` contract when `disposition: 'structured'`). Pass `binary({ mimeType, ... })` to declare a binary/text resource result - see [Resource Results](#resource-results-binary). Mutually exclusive with `chunk`. |
| `chunk` | `z.ZodType` | Optional Zod schema for individual chunks yielded by a streaming `run`. Required (and `run` must be an `async function*`) to make this a streaming action. See [Streaming Actions](#streaming-actions). |
| `kind` | `'query' \| 'mutation'` | Optional. Defaults to `'mutation'`. Marks the action as a cacheable read for tRPC. |
| `method` | `'GET' \| 'POST' \| 'PUT' \| 'DELETE'` | Optional REST verb for `@silkweave/fastify` / `@silkweave/nestjs` `rest`. Defaults to `POST`, or `GET` when `kind: 'query'`. See [REST routing](#rest-routing). |
| `path` | `string` | Optional REST route template, may contain `:param` placeholders (e.g. `'spaces/:spaceId/users'`). Each placeholder must be a key of `input`. See [REST routing](#rest-routing). |
| `queryParams` | `(keyof I)[]` | Optional input fields read from the URL query string instead of the body (e.g. `['offset', 'limit']`). See [REST routing](#rest-routing). |
| `args` | `(keyof I)[]` | Fields to expose as CLI positional arguments |
| `disposition` | `'json' \| 'smart' \| 'structured'` | Optional MCP result format - `'json'` (default) ⇒ `jsonToolResult`, `'smart'` ⇒ `smartToolResult` (sideloads payloads > 4096 chars), `'structured'` ⇒ declares `output` as the tool's MCP `outputSchema` contract and ships schema-parsed `structuredContent`. A client's `_meta.disposition` overrides `'json'`/`'smart'`; `'structured'` ignores it (the contract is fixed at `tools/list` time). `'structured'` requires a non-streaming action with `output` (validated at registration by `validateActionDisposition()`). MCP adapters only. |
| `annotations` | `ToolAnnotations` | Optional MCP tool annotations (`readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint`, `title`) forwarded to `tools/list`. MCP adapters derive `readOnlyHint` from `kind` (`'query'` ⇒ `true`) and merge explicit annotations over the derived base. MCP adapters only. |
| `tags` | `string[]` | Optional free-form grouping labels (e.g. `['leads', 'write']`). Carried on the action for the MCP adapters' per-request `filterActions` (and other consumers) to match on; no behavior in core itself. |
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

### Resource Results (binary)

An action can return a **binary or text artifact** - a screenshot, PDF, JSON/markdown artifact, audio clip - instead of a JSON object. Declare the output with `binary()` and return a `resource()`:

```typescript
import { binary, createAction, resource } from '@silkweave/core'
import z from 'zod/v4'

export const ScreenshotAction = createAction({
  name: 'screenshot',
  description: 'Capture a screenshot of a URL',
  kind: 'query',
  input: z.object({ url: z.string() }),
  output: binary({ mimeType: 'image/png' }),
  run: async ({ url }) => resource(await capture(url), {
    mimeType: 'image/png',
    name: 'screenshot.png',
    description: `Screenshot of ${url}`
  })
})
```

The `run` may return an `ActionResource` (via `resource()`), a Web-Standard `File`/`Blob`, or bare `Uint8Array`/`ArrayBuffer` bytes - adapters normalize with `toActionResource()`, using the `binary()` metadata as defaults for whatever the value doesn't carry (last resort: `application/octet-stream`). Each adapter then delivers the resource transport-appropriately: MCP maps mime-driven content blocks (raster images ⇒ `image` block the model can see, audio ⇒ `audio` block, text media ⇒ embedded resource `text`, else base64 `blob`, with `description` as a leading text block), REST sends raw bytes with `Content-Type`/`Content-Disposition` headers, the CLI pipes bytes or writes a file, and tRPC ships the `SerializedResource` JSON envelope.

| Export | Description |
|--------|-------------|
| `resource(data, { mimeType, name?, description? })` | Wrap bytes (`Uint8Array`/`ArrayBuffer`) or a string as an `ActionResource`. |
| `binary(meta?)` | Zod output schema over resource-like values; `meta` (`mimeType?`/`name?`/`description?`) are defaults for bare-byte returns. Incompatible with `disposition: 'structured'` and with `chunk` (validated at registration). |
| `toActionResource(value, defaults?)` | Async normalization: `ActionResource`/`File`/`Blob`/bytes ⇒ `ActionResource`, anything else ⇒ `undefined`. |
| `isActionResource` / `isResourceLike` / `isBinarySchema` / `binarySchemaMeta` | Detection helpers. |
| `serializeResource` / `deserializeResource` | The `SerializedResource` JSON envelope (`{ kind: 'resource', mimeType, name?, description?, text? \| base64? }`) used on JSON-only transports; text media types carry `text`, others `base64`. |
| `isTextMimeType(mimeType)` | `text/*`, JSON, XML/SVG, JavaScript, and `+json`/`+xml` suffixes. |
| `resourceBytes` / `resourceText` / `bytesToBase64` / `base64ToBytes` | Payload conversions (all Web-Standard - no Buffer, edge-safe). |

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
- [`@silkweave/edge`](https://www.npmjs.com/package/@silkweave/edge) - Web-Standard edge/serverless adapter (Cloudflare Workers, Vercel, Bun, Deno)
- [`@silkweave/typegen`](https://www.npmjs.com/package/@silkweave/typegen) - Build-time type generation
