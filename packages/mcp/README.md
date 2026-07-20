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
import { http } from '@silkweave/mcp/server'

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
| `filterActions` | `FilterActions` | Per-request tool filter - see [Per-request tool filtering](#per-request-tool-filtering-filteractions) |
| `onToolCall` | `OnToolCall` | Telemetry hook - see [Telemetry](#telemetry-ontoolcall) |

#### Per-request tool filtering (`filterActions`)

Because the transport is stateless, the tool list is recomputed on **every** request - which makes per-request scoping (per-API-key permissions, tool groups, read-only keys) a single callback:

```typescript
http({
  host: 'localhost', port: 8080,
  filterActions: async (actions, request) => {
    // request: { headers, url, method, toolName? }
    if (request.method === 'initialize' || request.method === 'ping') { return actions }  // skip the DB lookup
    const key = await lookupApiKey(request.headers.authorization)
    if (!key) { throw new SilkweaveError('invalid api key', 'invalid_key', 401) }
    return actions.filter((action) => action.tags?.some((tag) => key.allowedTags.includes(tag)))
  }
})
```

- Applies to `tools/list` **and** `tools/call` alike - a client that cached a wider list is still denied.
- `request.method` is the JSON-RPC method of the POSTed message; `request.toolName` is `params.name` on `tools/call`. Both double as an observability tap (e.g. counting `tools/list`).
- **Error semantics**: a thrown `SilkweaveError` propagates as its `statusCode` (401/403/...) with a JSON-RPC error body - SDK clients surface it as an auth failure. Any other throw maps to 500. A throw never produces an empty tool list; return `[]` explicitly if "no tools" is the intended answer.
- Permission changes apply on the next `tools/list` (clients refetch on reconnect) - no `listChanged` session machinery needed or offered.
- The same option exists on `mcpTransport()`, `@silkweave/edge`'s `edge()`, and `@silkweave/nestjs`'s `mcp()`. Actions carry optional `tags: string[]` as the natural thing to filter on.

#### Telemetry (`onToolCall`)

One hook observes every tool call - available on `stdio()`, `http()`, `mcpTransport()`, and `@silkweave/edge`'s `edge()`:

```typescript
http({
  host: 'localhost', port: 8080,
  onToolCall: (event) => {
    // { action, tool, transport: 'mcp', durationMs, ok, errorCode?, errorMessage?, args?, resultBytes?, sideloaded?, context }
    const auth = event.context.getOptional('auth')
    console.log(JSON.stringify({ event: 'tool_call', ...event, context: undefined, args: undefined, userId: auth?.userId }))
  }
})
```

- **Fire-and-forget**: never awaited on the result path; sync throws and async rejections are logged and swallowed - the hook can never fail, slow, or reorder a call.
- Fires after result formatting, so events carry `resultBytes` (serialized raw-result size) and `sideloaded` (whether `smartToolResult` offloaded to an embedded resource).
- `ok` is `false` when the action threw (with `errorCode`/`errorMessage` - a `SilkweaveError`'s `code`, else the error's name) or when the formatted result is an `isError` tool result.
- `args` is the call's input: the parsed (post-zod) input the action ran with - defaults applied, unknown keys stripped. **Unredacted** - like `event.context` (which carries the raw request incl. `Authorization` headers), redact and truncate before persisting.
- **Invalid arguments emit too**: the SDK rejects a `tools/call` that fails the input schema *before* the handler runs, so `http()`, `mcpTransport()`, and `edge()` pre-validate (emit-only - the SDK still produces its native rejection on the wire) and emit `ok: false` with the stable `errorCode: 'INVALID_ARGUMENTS'`, `errorMessage` naming the failing fields, `durationMs: 0`, and `args` set to the **raw offered input** exactly as the client sent it. A misbehaving agent hammering wrong schemas is now visible in metrics. `stdio()` does not emit these (no request seam). These events are cheap to trigger at high rate - batch/sample in the hook rather than writing per event.
- Streaming actions report `durationMs` across full generator consumption.
- `@silkweave/nestjs` wires this through DI instead - `forRoot({ telemetry: MyTelemetryService })` covers MCP **and** tRPC calls (including tRPC input-validation failures).

### cliProxy

MCP CLI proxy client - connects to a running HTTP MCP server and invokes tools from the command line. Imported from the dedicated `@silkweave/mcp/cli-proxy` subpath (kept out of the package root so importing the `stdio`/`http` servers does not pull the CLI client's `commander` into the server path). `commander` is an **optional peer dependency** - install it alongside `@silkweave/mcp` when you use the CLI proxy.

```typescript
import { silkweave } from '@silkweave/core'
import { cliProxy } from '@silkweave/mcp/cli-proxy'

await silkweave({ name: 'my-tools', description: 'My Tools', version: '1.0.0' })
  .adapter(cliProxy({ url: new URL('http://localhost:8080/mcp') }))
  .start()
```

#### Options

| Option | Type | Description |
|--------|------|-------------|
| `url` | `URL` | The MCP server's Streamable HTTP endpoint |
| `formatter` | `CLIFormatterFn` | Custom per-content-block output formatter |
| `headers` | `Record<string, string>` or a (async) thunk returning one | Extra headers sent on every request, merged over `requestInit.headers`. A thunk is resolved once per invocation, before connecting - use it to read a token lazily from config |
| `requestInit` | `RequestInit` | Passed through to `StreamableHTTPClientTransport` |
| `fetch` | `FetchLike` | Custom fetch implementation, passed through to the transport |
| `authProvider` | `OAuthClientProvider` | OAuth provider for full auth flows, passed through to the transport |

Authenticating against a bearer-gated server (e.g. `http({ auth })`) is one option:

```typescript
cliProxy({
  url: new URL(config.gatewayUrl + '/mcp'),
  headers: () => ({ authorization: `Bearer ${config.token}` })
})
```

A failed connect prints a short, legible message (`authentication failed for <origin> - check your token` on a 401/403) instead of an SDK stack trace, and root `--help`/`--version` still work when the server is unreachable (the subcommand list needs a live connection; the base help does not).

#### Positional arguments

Tools are synthesized as subcommands with one `--flag` per input field. A silkweave server can additionally mark input fields as **positional arguments** by declaring `args` on the action (or `@Mcp({ args })` in `@silkweave/nestjs`):

```typescript
createAction({
  name: 'create-identity',
  description: 'Create a new identity',
  input: z.object({ id: z.string(), profile: z.string().optional() }),
  args: ['id'],
  run: async ({ id, profile }) => { /* ... */ }
})
```

```bash
my-tools create-identity default --profile work   # instead of --id default
```

The MCP adapters publish `args` in the tool's `_meta` as `silkweave/args` (spec-legal, ignored by non-silkweave clients); `cliProxy` reads it and registers those fields as positionals in declared order - required fields (per the input schema) as `<required>` arguments, optional ones as `[optional]`.

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

### `disposition`

Tool results default to compact JSON (`jsonToolResult`). Set `disposition` on the action to change the format:

```typescript
createAction({
  name: 'my-action',
  description: 'Sideloads large payloads to an embedded resource',
  input: z.object({}),
  disposition: 'smart',          // 'json' (default) ⇒ jsonToolResult, 'smart' ⇒ smartToolResult
  run: async () => fetchData()
})
```

`'json'` and `'smart'` are only **defaults** - a client that sends `_meta.disposition` on the tool call always wins. Resolution order: client `_meta.disposition` → action `disposition` → `'json'`. (`@silkweave/nestjs` exposes this as `@Mcp({ result })`.)

> **Breaking change in 3.2:** the fallback default flipped from `'smart'` to `'json'`. Set `disposition: 'smart'` per action (or `defaultResult: 'smart'` in `@silkweave/nestjs`) to restore payload sideloading.

### Structured output (`disposition: 'structured'`)

A structured action declares its `output` Zod schema as the tool's MCP `outputSchema` - visible to agents in `tools/list` before they call, and returned as `structuredContent`:

```typescript
createAction({
  name: 'users.get',
  description: 'Get a user by id',
  input: z.object({ id: z.string() }),
  output: z.object({ id: z.string(), name: z.string() }),
  disposition: 'structured',
  run: async ({ id }) => getUser(id)   // may return a wider object - extra fields are stripped
})
```

Important semantics (the MCP SDK enforces output schemas on **both** sides - the server validates before responding and SDK clients validate independently against `tools/list` - so the schema is a hard contract, not a hint):

- The result is **parsed through `output` before shipping**: `structuredContent` is the parsed (extra-fields-stripped) data, plus a JSON text mirror in `content`. Returning a wider object than the schema is therefore safe by construction.
- A genuine mismatch (missing required field, wrong type) returns an **`isError` tool result** naming the failing fields - not an opaque protocol error - since `isError` results are exempt from SDK output validation.
- `_meta.disposition` is **ignored** for structured actions; the contract is fixed at `tools/list` time.
- `'structured'` requires a non-streaming action with an `output` schema - validated at registration (`validateActionDisposition()`), so misconfiguration fails at boot.
- Fields that can be `null` at runtime must be declared `.nullable()` (zod's `.optional()` does not accept `null`).

### Resource results (binary)

An action that returns a resource (declared with core's `binary()` output schema and returning `resource()`, a `File`/`Blob`, or bare bytes) bypasses `disposition` formatting entirely - `resourceToolResult()` maps it to mime-driven content blocks:

| Media type | Content block |
|------------|---------------|
| `description` set on the resource | Leading `text` block, so the model knows what the artifact is |
| Raster `image/*` (png/jpeg/gif/webp) | `image` block (base64) - multimodal hosts surface it to the model directly |
| `audio/*` | `audio` block (base64) |
| Text-based media (`text/*`, JSON, XML/SVG, `+json`/`+xml`) | Embedded `resource` with `text` |
| Anything else (PDF, zip, ...) | Embedded `resource` with a base64 `blob` |

```typescript
createAction({
  name: 'screenshot',
  description: 'Capture a screenshot of a URL',
  input: z.object({ url: z.string() }),
  output: binary({ mimeType: 'image/png' }),
  run: async ({ url }) => resource(await capture(url), {
    mimeType: 'image/png', name: 'screenshot.png', description: `Screenshot of ${url}`
  })
})
```

A `toolResult` hook still wins over the resource mapping, and a client's `_meta.disposition` cannot demote a resource result (json/smart would stringify bytes into garbage). `disposition: 'structured'` is incompatible with `binary()` and rejected at registration. Telemetry events report the payload byte length as `resultBytes` and `sideloaded: false` (a deliberate resource is not a smart offload).

The **cliProxy** decodes resource results client-side: `image`/`audio` blocks and non-text `blob` resources are written as raw bytes to a piped stdout (`my-cli screenshot > shot.png`, description on stderr), to `--output <path>`, or to a file named after the resource on an interactive TTY. Text resources (including smart-disposition offloads) keep printing as text.

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
| `smartToolResult(data)` | Formatter with automatic embedded resource splitting at 4096 chars (`disposition: 'smart'`) |
| `jsonToolResult(data, isError?)` | Simple inline `TextContent` JSON (no splitting) - the default formatter |
| `structuredToolResult(data)` | `structuredContent` + JSON text mirror for `disposition: 'structured'` actions. Pass output-schema-**parsed** data, never the raw result |
| `resourceToolResult(res)` | Mime-driven content blocks for an `ActionResource` (image/audio blocks, embedded text/blob resources, leading description text block) |
| `errorToolResult(error)` | Format a `SilkweaveError` as an error result |
| `handleToolError(error)` | Catch-all error handler used by all MCP adapters |

## See Also

- [Silkweave README](https://github.com/silkweave/silkweave) - Full documentation
- [`@silkweave/core`](https://www.npmjs.com/package/@silkweave/core) - Core library
- [`@silkweave/edge`](https://www.npmjs.com/package/@silkweave/edge) - Stateless MCP on Web-Standard edge/serverless runtimes (Cloudflare Workers, Vercel, Bun, Deno)
