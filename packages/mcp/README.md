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

Session-based MCP transport over HTTP with SSE streaming and resumability.

```typescript
import { silkweave } from '@silkweave/core'
import { http } from '@silkweave/mcp'

await silkweave({ name: 'my-tools', description: 'My Tools', version: '1.0.0' })
  .adapter(http({ host: 'localhost', port: 8080, allowedHosts: ['localhost'] }))
  .action(MyAction)
  .start()
```

Exposes `POST /mcp` (invoke tools), `GET /mcp` (SSE stream), and `DELETE /mcp` (terminate session). Built on Express with `StreamableHTTPServerTransport` from the MCP SDK.

| Option | Type | Description |
|--------|------|-------------|
| `host` | `string` | Bind address |
| `port` | `number` | Listen port |
| `allowedHosts` | `string[]` | Allowed hosts for DNS rebinding protection |
| `cors` | `CorsOptions \| boolean` | CORS config. `false` to disable, `true`/omit for permissive defaults (`origin: '*'`), or a [cors](https://www.npmjs.com/package/cors) options object. MCP-required headers are always exposed. |

### cliProxy

MCP CLI proxy client - connects to a running HTTP MCP server and invokes tools from the command line.

```typescript
import { silkweave } from '@silkweave/core'
import { cliProxy } from '@silkweave/mcp'

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

## Smart Tool Results

By default, all MCP adapters use `smartToolResult()` to format action return values:

- **Small responses** (≤ 4096 chars): returned as inline `TextContent` JSON
- **Large responses** (> 4096 chars): split into a short text summary + a base64 **embedded resource**, keeping the LLM's context window lean while preserving full data access

This is a server-side best practice for managing context bloat. Some MCP clients (e.g. VS Code since December 2025) handle this client-side for all tool calls, but most clients don't — `smartToolResult` ensures good behavior regardless of client capabilities.

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
- [`@silkweave/vercel`](https://www.npmjs.com/package/@silkweave/vercel) - Stateless MCP for Vercel
