# @silkweave/edge

Web-Standard edge/serverless adapter for [Silkweave](https://github.com/silkweave/silkweave) - deploy your actions as a **stateless** MCP server on any `(Request) => Response` runtime: **Cloudflare Workers, Vercel, Bun, Deno, Hono**, and Next.js.

It uses only Web Standard APIs (`Request`/`Response`/`ReadableStream`/Web Crypto) and the SDK's `WebStandardStreamableHTTPServerTransport` - no Express, no port binding - so the same handler drops onto any edge or serverless platform.

## Install

```bash
pnpm add @silkweave/core @silkweave/edge
```

## Usage

### Vanilla serverless function (Vercel / Bun / Deno)

```typescript
// api/mcp.ts
import { silkweave } from '@silkweave/core'
import { edge } from '@silkweave/edge'
import { MyAction } from '../actions/my-action.js'

const { adapter, handler } = edge()

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
import { edge } from '@silkweave/edge'
import { MyAction } from '../../../actions/my-action.js'

const { adapter, GET, POST, DELETE } = edge()

await silkweave({ name: 'my-tools', description: 'My MCP Server', version: '1.0.0' })
  .adapter(adapter)
  .action(MyAction)
  .start()

export { GET, POST, DELETE }
```

> For Next.js, [`@silkweave/nextjs`](https://www.npmjs.com/package/@silkweave/nextjs) wraps this adapter with catch-all path normalization and end-to-end tRPC types - prefer it over wiring `edge()` by hand.

### Cloudflare Workers

See the full [`examples/cloudflare`](https://github.com/silkweave/silkweave/tree/master/examples/cloudflare) example - a Worker with stateless MCP + Google Workspace OAuth 2.1 and OAuth state in Cloudflare KV, with a from-scratch setup guide.

## How It Works

- Uses `WebStandardStreamableHTTPServerTransport` from the MCP SDK in **stateless mode** (`sessionIdGenerator: undefined`)
- Each request creates a fresh `McpServer` + transport, registers tools, handles the request, and returns a Web Standard `Response`
- Only `POST` carries JSON-RPC; `GET` (standing SSE stream) and `DELETE` (session teardown) return `405`, since stateless mode has no session to attach a stream to or tear down (a `GET` stream would otherwise hang the request on serverless runtimes like Cloudflare Workers)
- Actions are registered as MCP tools using `PascalCase` names (same as the stdio and http adapters)
- Tool results use `smartToolResult()` by default. Large payloads (> 4096 chars) are automatically split into a text summary + embedded resource to reduce LLM context bloat. Actions can override this with a custom `toolResult` hook.
- Logging goes to `process.stderr` (serverless log drain) and MCP client notifications

## Streaming Actions

Streaming actions (see [`@silkweave/core`](https://www.npmjs.com/package/@silkweave/core)) work identically to [`@silkweave/mcp`](https://www.npmjs.com/package/@silkweave/mcp)'s `http()` adapter - chunks are delivered as `notifications/progress` over the Streamable HTTP transport when the client sends `_meta.progressToken`, with the JSON-stringified chunk in the `message` field. The tool call resolves with the buffered chunk array as the `CallToolResult`.

The same AI-host caveat applies as for stdio/http MCP: chunks reach the wire as standard MCP progress notifications, but most LLM hosts today consume them for UI rendering rather than as incremental data fed into the model's context. See the [`@silkweave/mcp` README](https://www.npmjs.com/package/@silkweave/mcp#what-this-means-for-ai-hosts) for the full discussion.

## Auth

`edge()` serves the full OAuth 2.1 surface when you pass an `auth` config - protected-resource metadata (RFC 9728), `/authorize`, `/token`, `/register`, and the provider callback - alongside the MCP transport, all from the one handler. Pass a bearer-validating `AuthConfig` from [`@silkweave/auth`](https://www.npmjs.com/package/@silkweave/auth), or a full provider (e.g. `google()`) from `@silkweave/auth/oauth`:

```typescript
import { google } from '@silkweave/auth/oauth'

const { adapter, handler } = edge({ auth: google({ /* clientId, clientSecret, resourceUrl, store, ... */ }) })
```

## Options

```typescript
const { adapter, handler } = edge({
  enableJsonResponse: true  // Return JSON instead of SSE streams
})
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `enableJsonResponse` | `boolean` | `false` | Return JSON responses instead of SSE streams |
| `auth` | `AuthConfig` | - | Bearer-token validation + OAuth routes (see [Auth](#auth)) |
| `path` | `string` | `/mcp` | The MCP transport path |

## Compound Return Pattern

Unlike other Silkweave adapters that are simple `AdapterFactory` functions, `edge()` returns a compound object:

```typescript
interface EdgeAdapter {
  adapter: AdapterGenerator                          // Pass to silkweave().adapter()
  handler: (request: Request) => Promise<Response>   // The request handler
  GET: (request: Request) => Promise<Response>       // Alias for handler
  POST: (request: Request) => Promise<Response>      // Alias for handler
  DELETE: (request: Request) => Promise<Response>    // Alias for handler
}
```

This is because edge/serverless platforms export request handlers rather than starting long-lived servers. The `adapter` property integrates with the Silkweave builder, while `handler`/`GET`/`POST`/`DELETE` are exported from your route file.

## Deployment

### Vercel configuration

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

CORS is not handled by the adapter (beyond OAuth/preflight). Configure it in your host framework - Next.js middleware, `vercel.json` headers, or Worker response headers:

```json
{
  "headers": [
    {
      "source": "/api/mcp",
      "headers": [
        { "key": "Access-Control-Allow-Origin", "value": "*" },
        { "key": "Access-Control-Allow-Methods", "value": "POST, OPTIONS" },
        { "key": "Access-Control-Allow-Headers", "value": "Content-Type, Authorization" }
      ]
    }
  ]
}
```

## See Also

- [Silkweave README](https://github.com/silkweave/silkweave) - Full documentation
- [`@silkweave/core`](https://www.npmjs.com/package/@silkweave/core) - Core library
- [`@silkweave/mcp`](https://www.npmjs.com/package/@silkweave/mcp) - MCP stdio and HTTP adapters
- [`examples/cloudflare`](https://github.com/silkweave/silkweave/tree/master/examples/cloudflare) - Cloudflare Worker + Google OAuth + KV example
