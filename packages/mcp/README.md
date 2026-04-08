# @silkweave/mcp

MCP transport adapters for [Silkweave](https://github.com/silkweave/silkweave) — expose your actions as MCP tools over stdio, Streamable HTTP, or via a CLI proxy client.

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

### cliProxy

MCP CLI proxy client — connects to a running HTTP MCP server and invokes tools from the command line.

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
| Return value | `TextContent` JSON response |
| Thrown errors | Structured error response |

Logging notifications (`logger.info()`, `logger.progress()`) are sent to the MCP client as `notifications/message` and `notifications/progress`.

## See Also

- [Silkweave README](https://github.com/silkweave/silkweave) — Full documentation
- [`@silkweave/core`](https://www.npmjs.com/package/@silkweave/core) — Core library
- [`@silkweave/vercel`](https://www.npmjs.com/package/@silkweave/vercel) — Stateless MCP for Vercel
