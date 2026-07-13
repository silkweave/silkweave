# @silkweave/mcp

MCP transport adapters for [Silkweave](https://github.com/silkweave/silkweave) - expose your actions as MCP tools over stdio, Streamable HTTP, or via a CLI proxy client.

## Install

```bash
pnpm add @silkweave/core @silkweave/mcp
```

## Adapters

### stdio

Standard MCP transport for local tool servers. Communicates over stdin/stdout.

```typescript
import { silkweave } from '@silkweave/core'
import { stdio } from '@silkweave/mcp'

await silkweave({ name: 'my-tools', description: 'My Tools', version: '1.0.0' })
  .adapter(stdio())
  .action(MyAction)
  .start()
```

Configure in Claude Desktop or Claude Code:

```json
{
  "mcpServers": {
    "my-tools": {
      "command": "node",
      "args": ["server.js"]
    }
  }
}
```

### http

**Stateless** MCP transport over HTTP with per-call SSE streaming (no sessions, so any request can hit any instance behind a plain load balancer).

```typescript
import { silkweave } from '@silkweave/core'
import { http } from '@silkweave/mcp'

await silkweave({ name: 'my-tools', description: 'My Tools', version: '1.0.0' })
  .adapter(http({ host: 'localhost', port: 8080, allowedHosts: ['localhost'] }))
  .action(MyAction)
  .start()
```

Exposes a single stateless `POST /mcp` (each call mints a fresh transport with `sessionIdGenerator: undefined`; progress streams over SSE per call). No `Mcp-Session-Id`, no `GET`/`DELETE` reconnect. Built on Express with `StreamableHTTPServerTransport` from the MCP SDK.

| Option | Type | Description |
|--------|------|-------------|
| `host` | `string` | Bind address |
| `port` | `number` | Listen port |
| `allowedHosts` | `string[]` | Allowed hosts for DNS rebinding protection |
| `cors` | `CorsOptions \| boolean` | CORS config. `false` to disable, `true`/omit for permissive defaults (`origin: '*'`), or a [cors](https://www.npmjs.com/package/cors) options object. MCP-required headers are always exposed. |

### cliProxy

MCP CLI proxy client - connects to a running HTTP MCP server and invokes tools from the command line. Imported from the dedicated `@silkweave/mcp/cli-proxy` subpath (kept out of the package root so importing the `stdio`/`http` servers does not pull the CLI client's `commander` into the server path). `commander` is an **optional peer dependency** - install it alongside `@silkweave/mcp` when you use the CLI proxy.

```typescript
import { silkweave } from '@silkweave/core'
import { cliProxy } from '@silkweave/mcp/cli-proxy'

await silkweave({ name: 'my-tools', description: 'My Tools', version: '1.0.0' })
  .adapter(cliProxy({ url: 'http://localhost:8080/mcp' }))
  .start()
```

## How Actions Become MCP Tools

| Action property | MCP tool property |
|-----------------|-------------------|
| `name: 'searchDocs'` | Tool name: `SearchDocs` (PascalCase) |
| `description` | Tool description |
| `input` (Zod schema) | `inputSchema` (JSON Schema) |
| Return value | `CallToolResult` via `smartToolResult` or custom `toolResult` hook |
| Thrown errors | Structured error response via `handleToolError` |

Logging notifications (`logger.info()`, `logger.progress()`) are sent to the MCP client as `notifications/message` and `notifications/progress`.

## Streaming Actions

Actions that declare a `chunk` schema and an `async function*` `run` (see [`@silkweave/core`](https://www.npmjs.com/package/@silkweave/core) for the action definition) stream over MCP using `notifications/progress`:

- The client opts in by sending `_meta.progressToken` with the tool call. The MCP TypeScript SDK does this automatically when the host registers a progress listener.
- For each yielded chunk, the adapter sends a `notifications/progress` with the same `progressToken`, a 1-based `progress` counter, and the JSON-stringified chunk in the `message` field. The send is awaited so transport backpressure flows back to your generator.
- The tool call resolves with the full buffered chunk array as the `CallToolResult`. Clients that did not opt in (no `progressToken`) receive only this final result.

```typescript
import { createAction } from '@silkweave/core'
import z from 'zod/v4'

createAction({
  name: 'generate-messages',
  description: 'Stream messages about a topic',
  input: z.object({ topic: z.string(), count: z.number().int().min(1).max(50) }),
  chunk: z.object({ index: z.number().int(), text: z.string() }),
  run: async function* ({ topic, count }) {
    for (let i = 0; i < count; i += 1) {
      yield { index: i, text: `Message ${i + 1} about ${topic}` }
    }
  }
})
```

### What this means for AI hosts

MCP `notifications/progress` is part of the standard protocol - chunks reach the wire correctly. But **what the host client does with them is up to the host**. Most LLM-driven MCP hosts today (Claude Code, Cursor, generic chat UIs) consume progress notifications for **UI rendering** (spinners, status text, progress bars) and **not** as incremental data fed into the model's context. From the model's perspective, an MCP tool call is still atomic - the model sees the final buffered result when the call returns, not the chunks in flight.

This is a host-side rendering choice, not a protocol limitation. If you need per-chunk model visibility today, expose the action via [`@silkweave/fastify`](https://www.npmjs.com/package/@silkweave/fastify) (SSE/NDJSON) or [`@silkweave/trpc`](https://www.npmjs.com/package/@silkweave/trpc) (subscriptions) and have your consumer iterate chunks directly.

## Smart Tool Results

By default, all MCP adapters use `smartToolResult()` to format action return values:

- **Small responses** (≤ 4096 chars): returned as inline `TextContent` JSON
- **Large responses** (> 4096 chars): split into a short text summary + a base64 **embedded resource**, keeping the LLM's context window lean while preserving full data access

This is a server-side best practice for managing context bloat. Some MCP clients (e.g. VS Code since December 2025) handle this client-side for all tool calls, but most clients don't. `smartToolResult` ensures good behavior regardless of client capabilities.

### Custom `toolResult` Hook

Actions can override the default formatting by defining a `toolResult` hook:

```typescript
import { createAction } from '@silkweave/core'
import { jsonToolResult, smartToolResult } from '@silkweave/mcp'

const MyAction = createAction({
  name: 'my-action',
  description: 'Example with custom tool result',
  input: z.object({ format: z.enum(['full', 'summary']).default('summary') }),
  run: async ({ format }, context) => {
    context.set('format', format)
    return fetchLargeDataset()
  },
  toolResult: (data, context) => {
    if (context.get('format') === 'full') {
      return smartToolResult(data)  // Use default smart splitting
    }
    // Return a lean summary as text + full data as embedded resource
    const summary = data.map(({ id, name }) => ({ id, name }))
    return {
      content: [
        { type: 'text', text: JSON.stringify(summary) },
        { type: 'resource', resource: {
          uri: 'mcp://my-app/dataset.json',
          mimeType: 'application/json',
          blob: Buffer.from(JSON.stringify(data)).toString('base64')
        }}
      ]
    }
  }
})
```

Return `undefined` from `toolResult` to fall through to the default `smartToolResult` behavior.

### Default `disposition`

For the common case of simply choosing `jsonToolResult` over `smartToolResult` (without a hook), set `disposition` on the action:

```typescript
createAction({
  name: 'my-action',
  description: 'Returns compact JSON by default',
  input: z.object({}),
  disposition: 'json',           // 'json' ⇒ jsonToolResult, 'smart' (default) ⇒ smartToolResult
  run: async () => fetchData()
})
```

This is only a **default** - a client that sends `_meta.disposition` on the tool call always wins. Resolution order: client `_meta.disposition` → action `disposition` → `'smart'`. (`@silkweave/nestjs` exposes this as `@Mcp({ result: 'json' })`.)

### Tool annotations

Every tool is registered with MCP `annotations` - behavior hints clients use to group and permission-gate tools. The registrar derives `readOnlyHint` from the action's `kind` (`'query'` ⇒ `true`, otherwise `false`) and merges the action's explicit `annotations` over that base:

```typescript
createAction({
  name: 'campaigns.delete',
  description: 'Delete a campaign permanently',
  input: z.object({ id: z.string() }),
  annotations: { destructiveHint: true, idempotentHint: true },  // merged over { readOnlyHint: false }
  run: async ({ id }) => remove(id)
})
```

All hints are advisory (`title`, `readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint` - see `ToolAnnotations` in `@silkweave/core`). `@silkweave/nestjs` derives them from the HTTP verb instead (`@Get` ⇒ read-only + idempotent, `@Delete` ⇒ destructive + idempotent) with an `@Mcp({ annotations })` override.

## MCP Result Utilities

All result utilities are exported from `@silkweave/mcp`:

| Function | Description |
|----------|-------------|
| `smartToolResult(data)` | Default formatter with automatic embedded resource splitting at 4096 chars |
| `jsonToolResult(data, isError?)` | Simple inline `TextContent` JSON (no splitting) |
| `errorToolResult(error)` | Format a `SilkweaveError` as an error result |
| `handleToolError(error)` | Catch-all error handler used by all MCP adapters |

## See Also

- [Silkweave README](https://github.com/silkweave/silkweave) - Full documentation
- [`@silkweave/core`](https://www.npmjs.com/package/@silkweave/core) - Core library
- [`@silkweave/edge`](https://www.npmjs.com/package/@silkweave/edge) - Stateless MCP on Web-Standard edge/serverless runtimes (Cloudflare Workers, Vercel, Bun, Deno)
