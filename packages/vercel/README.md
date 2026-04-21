# @silkweave/vercel

Vercel serverless adapter for [Silkweave](https://github.com/silkweave/silkweave) - deploy your actions as a stateless MCP server on Vercel.

## Install

```bash
pnpm add @silkweave/core @silkweave/vercel
```

## Usage

### Vanilla Vercel Functions

```typescript
// api/mcp.ts
import { silkweave } from '@silkweave/core'
import { vercel } from '@silkweave/vercel'
import { MyAction } from '../actions/my-action.js'

const { adapter, handler } = vercel()

await silkweave({ name: 'my-tools', description: 'My MCP Server', version: '1.0.0' })
  .adapter(adapter)
  .action(MyAction)
  .start()

export default { fetch: handler }
```

### Next.js App Router

```typescript
// app/api/mcp/route.ts
import { silkweave } from '@silkweave/core'
import { vercel } from '@silkweave/vercel'
import { MyAction } from '../../../actions/my-action.js'

const { adapter, GET, POST, DELETE } = vercel()

await silkweave({ name: 'my-tools', description: 'My MCP Server', version: '1.0.0' })
  .adapter(adapter)
  .action(MyAction)
  .start()

export { GET, POST, DELETE }
```

## How It Works

- Uses `WebStandardStreamableHTTPServerTransport` from the MCP SDK in **stateless mode** (`sessionIdGenerator: undefined`)
- Each request creates a fresh `McpServer` + transport, registers tools, handles the request, and returns a Web Standard `Response`
- Actions are registered as MCP tools using `PascalCase` names (same as the stdio and http adapters)
- Tool results use `smartToolResult()` by default. Large payloads (> 4096 chars) are automatically split into a text summary + embedded resource to reduce LLM context bloat. Actions can override this with a custom `toolResult` hook.
- Logging goes to `process.stderr` (Vercel log drain) and MCP client notifications

## Options

```typescript
const { adapter, handler } = vercel({
  enableJsonResponse: true  // Return JSON instead of SSE streams
})
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `enableJsonResponse` | `boolean` | `false` | Return JSON responses instead of SSE streams |

## Compound Return Pattern

Unlike other Silkweave adapters that are simple `AdapterFactory` functions, `vercel()` returns a compound object:

```typescript
interface VercelAdapter {
  adapter: AdapterGenerator                      // Pass to silkweave().adapter()
  handler: (request: Request) => Promise<Response>  // The request handler
  GET: (request: Request) => Promise<Response>      // Alias for handler
  POST: (request: Request) => Promise<Response>     // Alias for handler
  DELETE: (request: Request) => Promise<Response>    // Alias for handler
}
```

This is because Vercel functions export request handlers rather than starting long-lived servers. The `adapter` property integrates with the Silkweave builder, while `handler`/`GET`/`POST`/`DELETE` are exported from your route file.

## Deployment

### Vercel Configuration

```json
{
  "framework": null,
  "functions": {
    "api/mcp.ts": {
      "memory": 1024,
      "maxDuration": 60
    }
  },
  "rewrites": [
    { "source": "/mcp", "destination": "/api/mcp" }
  ]
}
```

### CORS

CORS is not handled by the adapter. Use Next.js middleware or Vercel headers configuration:

```json
{
  "headers": [
    {
      "source": "/api/mcp",
      "headers": [
        { "key": "Access-Control-Allow-Origin", "value": "*" },
        { "key": "Access-Control-Allow-Methods", "value": "GET, POST, DELETE, OPTIONS" },
        { "key": "Access-Control-Allow-Headers", "value": "Content-Type, Mcp-Session-Id" }
      ]
    }
  ]
}
```

## See Also

- [Silkweave README](https://github.com/silkweave/silkweave) - Full documentation
- [`@silkweave/core`](https://www.npmjs.com/package/@silkweave/core) - Core library
- [`@silkweave/mcp`](https://www.npmjs.com/package/@silkweave/mcp) - MCP stdio and HTTP adapters (stateful)
