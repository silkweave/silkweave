# Silkweave

**Write your logic once. Run it everywhere.**

Silkweave is a TypeScript toolkit that lets you define application logic as portable **Actions** and instantly expose them through any combination of transports - MCP servers (stdio, HTTP, and serverless), end-to-end-typed tRPC, REST APIs with auto-generated OpenAPI docs, and fully-featured CLIs. It also meets your framework where it is: expose existing **NestJS** controllers as MCP tools, project one action set onto **Next.js** App Router route handlers, or stream to the **Vercel AI SDK**'s `useChat`. No glue code required.

```
                  ┌───────────────────────────────────┐
                  │              ACTIONS              │
                  │  name + zod schema + async run()  │
                  └─────────────────┬─────────────────┘
                                    │
 ADAPTER  ┌────────────────┬────────┼────────┬────────────────┐
          │                │        │        │                │
  ┌───────▼──────┐ ┌───────▼──────┐ │ ┌──────▼───────┐ ┌──────▼───────┐
  │ MCP          │ │ API          │ │ │ CLI          │ │ EDGE         │
  │ Http/Stdio   │ │ tRPC/Fastify │ │ │ Commander    │ │ Serverless   │
  └──────────────┘ └──────────────┘ │ └──────────────┘ └──────────────┘
                                    │
 FEATURE    ┌───────────────────────┼───────────────────────┐
            │                       │                       │
  ┌─────────▼─────────┐   ┌─────────▼─────────┐   ┌─────────▼─────────┐
  │ AUTHENTICATION    │   │ CONTEXT BAG       │   │ TYPE GENERATION   │
  │ Oauth2/Bearer/JWT │   │ Typed/Extensible  │   │ Input/Output DTS  │
  └───────────────────┘   └───────────────────┘   └───────────────────┘
```

---

## Table of Contents

- [Why Silkweave](#why-silkweave)
- [Packages](#packages)
  - [Express-Optional MCP](#express-optional-mcp)
- [Quick Start](#quick-start)
- [Core Concepts](#core-concepts)
  - [Actions](#actions)
  - [Adapters](#adapters)
  - [The Silkweave Builder](#the-silkweave-builder)
- [Adapters in Depth](#adapters-in-depth)
  - [MCP Stdio](#mcp-stdio)
  - [MCP Streamable HTTP](#mcp-streamable-http)
  - [tRPC](#trpc)
  - [Fastify REST API](#fastify-rest-api)
  - [CLI](#cli)
  - [Edge Adapter](#edge-adapter)
- [Framework Integrations](#framework-integrations)
  - [NestJS](#nestjs)
  - [Next.js](#nextjs)
  - [Vercel AI SDK](#vercel-ai-sdk)
- [Authentication](#authentication)
  - [Resource-Server Core](#resource-server-core)
  - [Opt-in OAuth 2.1](#opt-in-oauth-21)
- [Logging and Progress](#logging-and-progress)
- [Advanced Patterns](#advanced-patterns)
  - [Multiple Adapters Simultaneously](#multiple-adapters-simultaneously)
  - [CLI Arguments vs Options](#cli-arguments-vs-options)
  - [Complex Input Types](#complex-input-types)
  - [MCP Tool Quality](#mcp-tool-quality)
  - [Action Linter](#action-linter)
- [MCP Client Configuration](#mcp-client-configuration)
- [API Reference](#api-reference)
- [Development](#development)

---

## Why Silkweave

Building an MCP server usually means wiring up transports, registering tools, serializing responses, and handling errors - for every single tool. If you also want a CLI or REST API for the same logic, you're writing it all again.

Silkweave eliminates this duplication. You define an **Action** - a name, a Zod schema, and an async function - and Silkweave handles the rest:

- **MCP adapters** register your actions as MCP tools with proper notifications, progress reporting, and error handling - over stdio, streamable HTTP, or stateless serverless (Edge / Web Standard) - plus agent-quality signals: [tool annotations, typed output contracts, per-request tool filtering, and call telemetry](#mcp-tool-quality)
- **tRPC adapter** exposes your actions as end-to-end type-safe procedures (`InferTrpcRouter<typeof server>`), as a standalone server or a fetch handler
- **Fastify adapter** generates a REST API with full OpenAPI/Swagger documentation derived from your Zod schemas
- **CLI adapter** builds a complete command-line interface with argument parsing, option flags, and plain `console` output
- **Framework integrations** meet you where you are - expose existing **NestJS** controllers as MCP tools via `@Mcp()`, project an action set onto **Next.js** App Router handlers (MCP + tRPC), or bridge a streaming action to the **Vercel AI SDK**'s `useChat`

Your action doesn't know or care which transport is running it.

---

## Packages

Silkweave is organized as a monorepo with modular packages. Install only what you need:

| Package | npm | Description |
|---------|-----|-------------|
| `@silkweave/core` | [![npm](https://img.shields.io/npm/v/@silkweave/core)](https://www.npmjs.com/package/@silkweave/core) | Core library - actions, adapters, builder, context, logger, utilities |
| `@silkweave/auth` | [![npm](https://img.shields.io/npm/v/@silkweave/auth)](https://www.npmjs.com/package/@silkweave/auth) | Auth - resource-server core (bearer-token validation + protected-resource metadata, RFC 9728); opt-in OAuth 2.1 authorization-server proxy (PKCE, refresh, CIMD, dynamic client registration) via `@silkweave/auth/oauth` |
| `@silkweave/mcp` | [![npm](https://img.shields.io/npm/v/@silkweave/mcp)](https://www.npmjs.com/package/@silkweave/mcp) | MCP adapters - stdio, streamable HTTP, CLI proxy |
| `@silkweave/cli` | [![npm](https://img.shields.io/npm/v/@silkweave/cli)](https://www.npmjs.com/package/@silkweave/cli) | CLI adapter - commander + plain `console` output |
| `@silkweave/fastify` | [![npm](https://img.shields.io/npm/v/@silkweave/fastify)](https://www.npmjs.com/package/@silkweave/fastify) | Fastify REST adapter - auto-generated OpenAPI/Swagger docs |
| `@silkweave/trpc` | [![npm](https://img.shields.io/npm/v/@silkweave/trpc)](https://www.npmjs.com/package/@silkweave/trpc) | tRPC adapter - end-to-end type-safe procedures (standalone server + fetch handler) |
| `@silkweave/edge` | [![npm](https://img.shields.io/npm/v/@silkweave/edge)](https://www.npmjs.com/package/@silkweave/edge) | Web-Standard edge/serverless adapter - stateless MCP over Streamable HTTP (Cloudflare Workers, Vercel, Bun, Deno) |
| `@silkweave/nestjs` | [![npm](https://img.shields.io/npm/v/@silkweave/nestjs)](https://www.npmjs.com/package/@silkweave/nestjs) | NestJS adapter - expose existing controllers as MCP tools via `@Mcp()` (input reflected from route + param decorators + swagger/class-validator) |
| `@silkweave/nextjs` | [![npm](https://img.shields.io/npm/v/@silkweave/nextjs)](https://www.npmjs.com/package/@silkweave/nextjs) | Next.js App Router adapter - `defineSilkweave({ actions })` projects one action set onto MCP + tRPC route handlers |
| `@silkweave/ai` | [![npm](https://img.shields.io/npm/v/@silkweave/ai)](https://www.npmjs.com/package/@silkweave/ai) | Vercel AI SDK bridge - wrap `streamText` as a streaming action and feed `useChat` over a tRPC subscription |
| `@silkweave/typegen` | [![npm](https://img.shields.io/npm/v/@silkweave/typegen)](https://www.npmjs.com/package/@silkweave/typegen) | Type generator - emit `.d.ts` interfaces from action Zod schemas |
| `@silkweave/skills` | [![npm](https://img.shields.io/npm/v/@silkweave/skills)](https://www.npmjs.com/package/@silkweave/skills) | Serve [Agent Skills](https://agentskills.io/specification) (`SKILL.md`) over MCP - versioned, digest-verified, SEP-2640-aligned |
| `silkweave` | [![npm](https://img.shields.io/npm/v/silkweave)](https://www.npmjs.com/package/silkweave) | The Silkweave CLI - `npx silkweave skills sync` (install/update skills from a server) and `npx silkweave proxy <url>` (any MCP server as a CLI) |

**`@silkweave/core`** is always required. Then add the adapter packages for the transports you need:

```bash
# MCP server (stdio or HTTP)
pnpm add @silkweave/core @silkweave/mcp

# tRPC (end-to-end typed)
pnpm add @silkweave/core @silkweave/trpc

# REST API with Swagger
pnpm add @silkweave/core @silkweave/fastify

# CLI tool
pnpm add @silkweave/core @silkweave/cli

# Edge / Web Standard serverless MCP (Cloudflare Workers, Vercel, Bun, Deno)
pnpm add @silkweave/core @silkweave/edge

# NestJS controllers as MCP tools
pnpm add @silkweave/core @silkweave/nestjs

# Next.js App Router (MCP + tRPC)
pnpm add @silkweave/core @silkweave/nextjs

# Serve Agent Skills from an MCP server (then: npx silkweave skills sync)
pnpm add @silkweave/core @silkweave/mcp @silkweave/skills
```

### Express-Optional MCP

`express` and `cors` are **optional `peerDependencies`** of `@silkweave/mcp` - they are only needed for the Express-based `http()` server. The transport-agnostic tool-registration and result helpers are re-exported from the express-free **`@silkweave/mcp/tools`** subpath, which the Web-Standard adapters (`@silkweave/edge`, `@silkweave/nextjs`) import. This means a serverless bundle or install never pulls Express into its graph.

```typescript
// Express-free: tool-registration + result helpers, no express/cors
import { registerTools, smartToolResult } from '@silkweave/mcp/tools'
```

If you use the Express `http()` server, install the peers:

```bash
pnpm add @silkweave/core @silkweave/mcp express cors
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
| Return value | `TextContent` JSON response |
| Thrown errors | Structured error response with name, message, and stack |

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

### tRPC

Exposes your actions as **end-to-end type-safe** tRPC procedures. Each action becomes a `query` or `mutation` (per its `kind`) at `camelCase(action.name)`, and the exported `InferTrpcRouter<typeof server>` gives your client a fully-typed `AppRouter` - no code generation.

```typescript
import { silkweave } from '@silkweave/core'
import { type InferTrpcRouter, trpc } from '@silkweave/trpc'

const server = silkweave({ name: 'my-api', description: 'My API', version: '1.0.0' })
  .adapter(trpc({ host: 'localhost', port: 8080 }))
  .action(SearchAction)

export type AppRouter = InferTrpcRouter<typeof server>

await server.start() // tRPC server on http://localhost:8080/trpc/
```

```typescript
// client.ts - fully typed against your actions
import { createTRPCClient, httpBatchLink } from '@trpc/client'
import type { AppRouter } from './server.js'

const client = createTRPCClient<AppRouter>({ links: [httpBatchLink({ url: 'http://localhost:8080/trpc' })] })
const { results } = await client.search.query({ query: 'hello', limit: 5 })
```

For serverless runtimes (Astro, Vercel, Cloudflare Workers), use **`trpcFetch()`** instead - it returns a Web Standard `(Request) => Promise<Response>` handler (plus `GET`/`POST`) rather than binding a port. Streaming actions are registered as tRPC **subscriptions** automatically.

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

Transforms your actions into a complete command-line application with help text, option parsing, and plain `console` output.

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

Deploy your actions as a stateless MCP server on any Web-Standard edge/serverless runtime - **Cloudflare Workers, Vercel, Bun, Deno, Hono**. Each request creates a fresh server instance - no sessions, no persistent connections, fully compatible with serverless constraints.

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

The `edge()` function returns a compound object - `adapter` wires into the Silkweave builder, while `handler`/`GET`/`POST`/`DELETE` are the request handler for your route.

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
- Only `POST` carries JSON-RPC; `GET` (standing SSE stream) and `DELETE` (session teardown) return `405`, since stateless mode has no session to attach a stream to or tear down (a `GET` stream would otherwise hang the request on serverless runtimes)
- Logging goes to `process.stderr` (Vercel log drain) and MCP client notifications
- No CORS handling - use Next.js middleware or `vercel.json` headers

**`EdgeAdapterOptions`:**

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `enableJsonResponse` | `boolean` | `false` | Return JSON instead of SSE streams |
| `auth` | `AuthConfig` | - | Bearer-token validation + OAuth routes |
| `path` | `string` | `/mcp` | The MCP transport path |

Because it's a Web Standard `(Request) => Response` handler, the same `edge()` adapter runs unchanged on **Cloudflare Workers**, Vercel, Bun, Deno, and Hono. The [`examples/cloudflare`](./examples/cloudflare) example is a full Worker deployment - stateless MCP + Google Workspace OAuth 2.1 with OAuth state in Cloudflare KV (using `createRedisStore` over a KV adapter, since Workers have no filesystem) - with a from-scratch Cloudflare + Google setup guide in its README.

---

## Framework Integrations

Beyond the transport adapters, Silkweave meets your framework where it is.

### NestJS

[`@silkweave/nestjs`](https://www.npmjs.com/package/@silkweave/nestjs) exposes your **existing NestJS controllers** as MCP tools - additively. Add `@Mcp()` to a route handler and its name, description, and input schema are **reflected** from the route, the `@Param`/`@Query`/`@Body` decorators, and any `@nestjs/swagger` / `class-validator` metadata the method already carries. On a tool call the validated input is split back into the method's positional arguments and the handler runs directly, with `@UseGuards()` applied first.

```typescript
@Controller('users')
export class UsersController {
  @Get(':id')
  @ApiParam({ name: 'id', description: 'User ID' })
  @Mcp() // -> MCP tool "UsersGet", input { id: string }
  get(@Param('id') id: string) {
    return this.users.find(id)
  }
}

@Module({
  imports: [SilkweaveModule.forRoot({
    silkweave: { name: 'my-app', description: 'My app', version: '1.0.0' },
    adapters: [mcp({ basePath: '/mcp' })]
  })],
  controllers: [UsersController]
})
export class AppModule {}
```

Controllers keep serving HTTP unchanged; removing `@Mcp()` fully reverts a method.

### Next.js

[`@silkweave/nextjs`](https://www.npmjs.com/package/@silkweave/nextjs) projects **one action set** onto Next.js **App Router** route handlers - MCP tools for agents and a typed tRPC endpoint for your frontend - from a single source of truth. It's action-first and additive (it only adds route files), wrapping `@silkweave/edge` and `@silkweave/trpc` with catch-all path normalization and end-to-end tRPC types. No `next`/`react` dependency.

```typescript
// silkweave/server.ts
import { defineSilkweave } from '@silkweave/nextjs'
import { banUser, listUsers } from './actions'

export const app = defineSilkweave({
  name: 'my-app', description: 'My app', version: '1.0.0',
  actions: [listUsers, banUser]
})
export type AppRouter = typeof app.Router
```

```typescript
// app/api/mcp/[[...mcp]]/route.ts  - one catch-all serves transport + OAuth + well-known
export const { GET, POST, DELETE, OPTIONS } = app.mcp({ basePath: '/api/mcp' })
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// app/api/trpc/[trpc]/route.ts
export const { GET, POST, OPTIONS } = app.trpc({ endpoint: '/api/trpc' })
```

### Vercel AI SDK

[`@silkweave/ai`](https://www.npmjs.com/package/@silkweave/ai) bridges the [Vercel AI SDK](https://ai-sdk.dev)'s `useChat` hook to a Silkweave **streaming action** over a tRPC subscription - no `/api/chat` route, no Data Stream Protocol parsing. `createChatAction()` wraps `streamText()` into a streaming action; `silkweaveTransport()` is a custom `ChatTransport` that turns a subscribe-style function into the `ReadableStream<UIMessageChunk>` `useChat` consumes directly.

---

## Authentication

[`@silkweave/auth`](https://www.npmjs.com/package/@silkweave/auth) is split into two layers so a pure resource server never pulls the OAuth issuer machinery into its graph:

- **Root (`@silkweave/auth`)** - the spec-required **resource-server core** (jose-only): validate bearer tokens, delegate issuance to an external IdP.
- **`@silkweave/auth/oauth`** - the opt-in **authorization-server** layer: front your own OAuth 2.1 flow, with persistence stores.

`AuthConfig` is accepted by the MCP `http()`, `edge()`, tRPC, and framework adapters.

### Resource-Server Core

The root export is the minimal, spec-required core: bearer-token validation (expiry + issuer binding per RFC 9207, audience binding per RFC 8707, step-up `scope` challenge per SEP-2350) plus protected-resource metadata (RFC 9728, including `scopes_supported`). It is **jose-only** - importing it never pulls the OAuth issuer machinery.

```typescript
import { edge } from '@silkweave/edge'
import type { AuthConfig } from '@silkweave/auth'

const auth: AuthConfig = {
  // validate the bearer token against your external IdP
  verifyToken: async (token) => {
    const claims = await validateWithIdp(token)
    return { token, clientId: claims.sub, scopes: claims.scope?.split(' ') ?? [] }
  }
}

const { adapter, handler } = edge({ auth })
```

### Opt-in OAuth 2.1

To front your own OAuth 2.1 flow, import from the **`@silkweave/auth/oauth`** subpath. This is where the authorization-server proxy lives - PKCE, refresh tokens, client ID metadata documents (CIMD), and dynamic client registration - along with the persistence stores (memory, JSON file, and Redis). Providers like `google()` and the `createRedisStore` / `createJsonStore` factories all come from this subpath.

```typescript
import { edge } from '@silkweave/edge'
import { google, createJsonStore } from '@silkweave/auth/oauth'

const auth = google({
  clientId: process.env.GOOGLE_CLIENT_ID!,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
  store: createJsonStore('./oauth-state.json')
})

const { adapter, handler } = edge({ auth })
```

Importing only `@silkweave/auth` keeps the issuer/store machinery out of your bundle; reach for `@silkweave/auth/oauth` only when you run the OAuth 2.1 flow yourself.

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

### MCP Tool Quality

Four features (3.2) make the MCP surface agent-grade - all opt-in, all defined on the action or the adapter:

```typescript
createAction({
  name: 'users.get',
  description: 'Get a user by id',
  input: z.object({ id: z.string().describe('User id from UsersList') }),
  output: z.object({ id: z.string(), name: z.string() }),
  disposition: 'structured',                    // output becomes the MCP outputSchema contract
  annotations: { idempotentHint: true },        // merged over the kind-derived readOnlyHint
  tags: ['users', 'read'],                      // matched by filterActions below
  kind: 'query',
  run: async ({ id }) => getUser(id)
})

http({
  host: 'localhost', port: 8080,
  filterActions: async (actions, request) => scopeToApiKey(actions, request),  // per-request tool list
  onToolCall: (event) => log('tool_call', event)                               // fire-and-forget telemetry
})
```

- **Tool annotations** - every tool ships `ToolAnnotations` (`readOnlyHint` derived from `kind`; explicit fields win), which MCP hosts use to group and permission-gate tools.
- **Structured output** (`disposition: 'structured'`) - the `output` schema is visible in `tools/list` before the call and the schema-parsed result ships as `structuredContent` (extra fields stripped; mismatches degrade to agent-legible tool errors). Note the default result format is now compact JSON - `disposition: 'smart'` opts back into embedded-resource sideloading for large payloads.
- **Per-request tool filtering** (`filterActions`) - the stateless transports recompute the tool list per request, so per-API-key permissions are one callback; a thrown `SilkweaveError` surfaces as its `statusCode`, never an empty tool list.
- **Telemetry** (`onToolCall`) - one fire-and-forget event per call (`durationMs`, `ok`, `resultBytes`, `sideloaded`, resolved auth via `context`); in NestJS wired through DI (`forRoot({ telemetry: MyTelemetryService })`) covering MCP **and** tRPC.

See the [@silkweave/mcp README](./packages/mcp) for details.

### Action Linter

Silkweave ships a dev-time guardrail that flags **agent-hostile** action definitions - missing or throwaway `description` text and undescribed input params - the cheap mistakes that quietly degrade an agent's tool use.

`silkweave().start()` runs the linter automatically, emitting warnings to stderr via `console.warn` (safe for stdio servers). Disable it with `SilkweaveOptions.lint: false`:

```typescript
await silkweave({ name: 'my-tools', description: 'My Tools', version: '1.0.0', lint: false })
  .adapter(stdio())
  .action(MyAction)
  .start()
```

You can also run it directly via `lintActions(actions)` (returns the findings) or `reportActionLint(actions)` (prints them), both exported from `@silkweave/core`.

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
  output?: z.ZodType<O>                             // used by typegen + tRPC
  kind?: 'query' | 'mutation'                       // tRPC dispatch (default 'mutation')
  args?: (keyof I)[]                                // CLI positional args
  isEnabled?: (context: SilkweaveContext) => boolean
  run: (input: I, context: SilkweaveContext) => Promise<O>
}
```

Actions can also **stream**: declare a `chunk` Zod schema and an `async function*` `run` that yields chunks. Adapters detect this and switch to per-chunk delivery (MCP progress notifications, SSE/NDJSON over Fastify, tRPC subscriptions, NDJSON over the CLI). The `@silkweave/fastify` adapter additionally honors optional `method` / `path` / `queryParams` fields for REST routing.

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

// CLI via commander - from @silkweave/cli
import { cli } from '@silkweave/cli'
function cli(): AdapterFactory

// tRPC - from @silkweave/trpc
import { trpc, trpcFetch, type InferTrpcRouter } from '@silkweave/trpc'
function trpc(options: { host: string; port: number; endpoint?: string; auth?: AuthConfig }): AdapterGenerator
function trpcFetch(options?: { endpoint?: string; auth?: AuthConfig }): {
  adapter: AdapterGenerator
  handler: (req: Request) => Promise<Response>
  GET: (req: Request) => Promise<Response>
  POST: (req: Request) => Promise<Response>
}
type AppRouter = InferTrpcRouter<typeof server>  // typed client router

// Edge / serverless - from @silkweave/edge
import { edge } from '@silkweave/edge'
function edge(options?: EdgeAdapterOptions): EdgeAdapter
interface EdgeAdapterOptions {
  enableJsonResponse?: boolean
  auth?: AuthConfig
  path?: string
}
interface EdgeAdapter {
  adapter: AdapterGenerator          // Pass to silkweave().adapter()
  handler: (req: Request) => Promise<Response>
  GET: (req: Request) => Promise<Response>
  POST: (req: Request) => Promise<Response>
  DELETE: (req: Request) => Promise<Response>
}

// Next.js App Router - from @silkweave/nextjs
import { defineSilkweave } from '@silkweave/nextjs'
function defineSilkweave(options: SilkweaveOptions & { actions: Action[] }): SilkweaveApp
interface SilkweaveApp {
  mcp(options: { basePath: string; auth?: AuthConfig }): { GET; POST; DELETE; OPTIONS }
  trpc(options: { endpoint: string; auth?: AuthConfig; cors?: boolean }): { GET; POST; OPTIONS }
  readonly Router: AppRouter         // type-only phantom: `typeof app.Router`
}

// NestJS - from @silkweave/nestjs
import { mcp, Mcp, SilkweaveModule } from '@silkweave/nestjs'
// @Mcp() decorates a controller route; SilkweaveModule.forRoot({ adapters: [mcp()] })
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
pnpm -F @silkweave/example-trpc dev        # tRPC standalone server on :8080/trpc/
pnpm -F @silkweave/example-fastify dev     # Fastify REST API with Swagger on :8080
pnpm -F @silkweave/example-cli dev         # CLI mode
pnpm -F @silkweave/example-cloudflare dev  # Stateless edge MCP on Cloudflare Workers (Web Standard)
pnpm -F @silkweave/example-nestjs dev      # NestJS controllers as MCP tools on :8080
pnpm -F @silkweave/example-nextjs dev      # Next.js App Router: MCP (/api/mcp) + tRPC (/api/trpc) on :8080
```

Requires Node.js >= 18.

---

## License

MIT
