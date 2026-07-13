# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

Silkweave is a TypeScript toolkit for building MCP (Model Context Protocol) servers and CLI tools from a single set of "Actions". Define an action once, then expose it via multiple adapters (MCP stdio, MCP HTTP, Fastify REST API, tRPC, or CLI).

## Commands

```bash
pnpm build          # Build all packages with tsdown (ESM output to build/)
pnpm check          # Lint + typecheck all packages
pnpm clean          # Clean all build outputs and turbo cache

# Run example servers (not automated tests - these start live servers)
pnpm -F @silkweave/example-core dev        # Run an Action directly without an adapter
pnpm -F @silkweave/example-cli dev         # CLI adapter (commander)
pnpm -F @silkweave/example-mcp stdio       # MCP stdio server
pnpm -F @silkweave/example-mcp http        # MCP streamable HTTP server on :8080
pnpm -F @silkweave/example-mcp http-auth   # MCP HTTP with bearer token auth on :8080
pnpm -F @silkweave/example-mcp http-oauth  # MCP HTTP with Google OAuth 2.1 on :8080
pnpm -F @silkweave/example-mcp cli-proxy   # MCP CLI proxy client (connects to http example)
pnpm -F @silkweave/example-fastify dev     # Fastify REST API with Swagger on :8080
pnpm -F @silkweave/example-trpc dev        # tRPC standalone HTTP server on :8080/trpc/
pnpm -F @silkweave/example-typegen dev     # Generate .d.ts from action Zod schemas
pnpm -F @silkweave/example-nestjs dev      # NestJS controllers exposed as MCP tools via @Mcp, on :8080
pnpm -F @silkweave/example-nextjs dev      # Next.js App Router: one action set as MCP (/api/mcp) + tRPC (/api/trpc), on :8080
pnpm -F @silkweave/example-cloudflare dev  # Cloudflare Worker: stateless MCP + Google OAuth 2.1 + KV-backed store (wrangler dev on :8787)

# AI chat example (Vite + React + useChat + tRPC subscriptions)
ANTHROPIC_API_KEY=sk-... pnpm -F @silkweave/example-ai dev

# MCP Inspector (connects to MCP stdio example via .mcp.json)
pnpm mcp
```

## Architecture

The core pattern is **Action → Adapter → Silkweave**:

- **Action** (`packages/core/src/util/action.ts`): A named operation with a Zod `input` schema, an optional Zod `output` schema, and an async `run(input, context)` function. Actions are adapter-agnostic - they receive a `Logger` via context. The `output` schema is used by the typegen and tRPC adapters to generate typed response interfaces. An optional `kind: 'query' | 'mutation'` field (default `'mutation'`) controls how the action is exposed over tRPC - queries are GET-cacheable, mutations are POST. the `@silkweave/fastify` REST adapter additionally honors three optional routing fields: `method` (`'GET' | 'POST' | 'PUT' | 'DELETE'`, default `POST` or `GET` when `kind: 'query'`), `path` (a route template that may contain `:param` placeholders, e.g. `'spaces/:spaceId/users'`), and `queryParams` (input fields read from the URL query string instead of the body, e.g. `['offset', 'limit']`). Path placeholders and query params must be keys of the input schema; the input is merged from path + query + body and validated as one (see [REST routing](#rest-routing) below). An optional `toolResult(response, context)` hook lets actions control how results are formatted as MCP `CallToolResult` (e.g. returning embedded resources for large payloads); an optional `disposition: 'json' | 'smart' | 'structured'` field sets the MCP result format - `'json'` (the default since 3.2; was `'smart'`) ⇒ `jsonToolResult`, `'smart'` ⇒ `smartToolResult`, `'structured'` ⇒ the `output` schema becomes the tool's MCP `outputSchema` contract and the schema-**parsed** (extra-fields-stripped) result ships as `structuredContent` (+ JSON text mirror). A client `_meta.disposition` overrides `'json'`/`'smart'` but never `'structured'` (the contract is fixed at `tools/list` time). `'structured'` requires a non-streaming action with `output` - `validateActionDisposition()` throws at registration otherwise (called from `stdio()`/`mcpTransport()`/`edge()` boot paths). An optional `tags?: string[]` field carries free-form grouping labels for the MCP adapters' per-request `filterActions` to match on (no behavior in core). An optional `annotations` field (`ToolAnnotations` - `readOnlyHint`/`destructiveHint`/`idempotentHint`/`openWorldHint`/`title`) is forwarded to MCP `tools/list`; MCP adapters derive `readOnlyHint` from `kind` (`'query'` ⇒ read-only) and merge explicit annotations over the derived base. `Action<I, O, N, K>` is generic over input/output types, the literal `name`, and `kind` - literal types are preserved through `createAction()` so the `Silkweave<Actions>` builder can thread action types to type-aware adapters like tRPC. Actions can also be **streaming**: declare a `chunk` Zod schema and an `async function*` `run` that yields chunks; adapters detect this via `isStreamingAction()` and switch to per-chunk wire delivery (see [Streaming](#streaming) below).
- **Adapter** (`packages/core/src/util/adapter.ts`): Translates actions into a specific transport. `AdapterFactory<T>` takes config options, returns an `AdapterGenerator` that takes `SilkweaveOptions` and produces an `Adapter` with `start(actions)` / `stop()`.
- **Silkweave** (`packages/core/src/lib/silkweave.ts`): Fluent builder - `silkweave(opts).adapter(generator).action(action).start()`. `Silkweave<Actions extends Record<string, Action>>` is generic over accumulated actions so `typeof server` carries action type info forward; type-aware adapters (e.g. `@silkweave/trpc`'s `InferTrpcRouter<typeof server>`) extract this for end-to-end type safety.

### Packages

| Package | Path | Description |
|---------|------|-------------|
| `@silkweave/core` | `packages/core` | Core library - actions, adapters, builder, context, logger, utilities |
| `@silkweave/auth` | `packages/auth` | Auth - **resource-server core** (spec-required, `jose`-only): bearer-token validation (expiry + issuer binding RFC 9207, audience binding RFC 8707, step-up `scope` challenge SEP-2350) + protected resource metadata (RFC 9728, with `scopes_supported`). The OAuth 2.1 **authorization-server** proxy (PKCE, refresh tokens, CIMD, dynamic client registration) + persistence stores live behind the opt-in **`@silkweave/auth/oauth`** subpath, so a pure resource server never pulls the issuer machinery into its graph. The OAuth *types* (`OAuthRequest`/`OAuthResponse`/`OAuthProvider`) stay at the root because `AuthConfig.provider` references them. |
| `@silkweave/mcp` | `packages/mcp` | MCP adapters - stdio, streamable HTTP, CLI proxy. `express` + `cors` are **optional peer deps** (needed only for the Express `http()` server); the transport-agnostic tool-registration + result helpers are re-exported from the express-free **`@silkweave/mcp/tools`** subpath, which web-standard adapters (`@silkweave/edge`, `@silkweave/nextjs`) import so they never pull Express into a serverless bundle/install. |
| `@silkweave/cli` | `packages/cli` | CLI adapter - commander (plain `console` output, no terminal-UI dep) |
| `@silkweave/fastify` | `packages/fastify` | Fastify REST adapter - auto-generated OpenAPI/Swagger docs |
| `@silkweave/trpc` | `packages/trpc` | tRPC adapter - end-to-end type-safe procedures via `InferTrpcRouter<typeof server>` |
| `@silkweave/edge` | `packages/edge` | Web-Standard edge/serverless adapter - stateless MCP over Streamable HTTP. Pure `(Request) => Response` (no Express, Web Crypto only), so the one adapter runs on Cloudflare Workers, Vercel, Bun, Deno, Hono, and Next.js. Exposes `edge()` returning `{ adapter, handler, GET, POST, DELETE }`; serves the full OAuth surface when given `auth`. Opt-in DNS-rebinding protection via `allowedHosts`/`allowedOrigins` (forwarded to the transport), and `corsOrigin` to restrict the default wildcard `Access-Control-Allow-Origin`. A top-level try/catch maps any handler throw (malformed OAuth body, boot-failure `_ready` rejection) to a JSON error Response instead of an opaque host 500. |
| `@silkweave/nextjs` | `packages/nextjs` | Next.js App Router adapter - action-first and additive. `defineSilkweave({ actions })` projects one action set onto Next.js route handlers: `app.mcp()` (MCP tools, for agents) and `app.trpc()` (tRPC endpoint, for the frontend). Wraps `@silkweave/edge` + `@silkweave/trpc`, adding catch-all path normalization and end-to-end tRPC types. App Router only; no `next`/`react` dependency (Web-Standard `Request`/`Response`). |
| `@silkweave/nestjs` | `packages/nestjs` | NestJS adapter - the `@Mcp` and `@Trpc` method decorators expose existing controller routes as MCP tools / tRPC procedures; input schemas are reflected from the route + `@Param`/`@Query`/`@Body` decorators + `@nestjs/swagger`/`class-validator` metadata (+ optional OpenAPI doc); on a call the input is re-bound into the method's positional args (guards applied first). `@Trpc` adds output types (reflected from `@ApiOkResponse` or `@Trpc({ output })`), verb-inferred `kind`, and `async *`-as-subscription; the `mcp()`/`trpc()`/`typegen()` adapters consume the respective decorators |
| `@silkweave/typegen` | `packages/typegen` | Type generator - emits `.d.ts` interfaces from action Zod schemas using the TypeScript compiler API |
| `@silkweave/ai` | `packages/ai` | Vercel AI SDK bridge - `createChatAction()` wraps `streamText` into a streaming action; `silkweaveTransport()` is a custom `ChatTransport` that adapts any subscribe-style function (typically a tRPC subscription) into the `ReadableStream<UIMessageChunk>` that `useChat` consumes |
| `@silkweave/example-*` | `examples/*` | One example per adapter package: `examples/core`, `examples/cli`, `examples/mcp`, `examples/fastify`, `examples/trpc`, `examples/typegen`, `examples/edge`, `examples/nestjs`, `examples/nextjs`. Each is a self-contained workspace package with its own `package.json`, `tsconfig.json`, `eslint.config.mjs`, and minimal inline actions. |
| `@silkweave/example-ai` | `examples/ai` | End-to-end chat app: Vite + React + `useChat` → `silkweaveTransport` → tRPC subscription → Silkweave streaming action → AI SDK `streamText`. Run with `pnpm -F @silkweave/example-ai dev` (needs `ANTHROPIC_API_KEY`). |
| `@silkweave/example-cloudflare` | `examples/cloudflare` | Deployment example (not a new adapter): the `edge()` Web-Standard adapter on a **Cloudflare Worker** - stateless MCP + **Google Workspace OAuth 2.1** with OAuth state in **Cloudflare KV** (reuses `createRedisStore` over a tiny KV adapter, since Workers have no filesystem for `createJsonStore`). App built lazily per-request because KV/secrets arrive on `env`. `wrangler.jsonc` + `.dev.vars.example`; README has from-scratch Cloudflare + Google setup. Run with `pnpm -F @silkweave/example-cloudflare dev`. |

### Adapters

| Adapter | Package | File | Transport |
|---------|---------|------|-----------|
| `stdio` | `@silkweave/mcp` | `packages/mcp/src/adapter/stdio.ts` | MCP over stdin/stdout (`StdioServerTransport`) |
| `http` | `@silkweave/mcp` | `packages/mcp/src/adapter/http.ts` | MCP Streamable HTTP (`express`, **stateless** - each `POST /mcp` mints a fresh transport with `sessionIdGenerator: undefined`; no `Mcp-Session-Id`, no session map, no `GET`/`DELETE` reconnect) |
| `cliProxy` | `@silkweave/mcp/cli-proxy` | `packages/mcp/src/adapter/cliProxy.ts` | MCP CLI proxy client (`commander` + `StreamableHTTPClientTransport`). Exposed from the dedicated `@silkweave/mcp/cli-proxy` subpath (not the package root) so importing the `stdio`/`http` servers never pulls the CLI client's `commander`, which is an **optional peer dep** of `@silkweave/mcp`. |
| `fastify` | `@silkweave/fastify` | `packages/fastify/src/adapter/fastify.ts` | REST API with Swagger UI via `@scalar/fastify-api-reference` |
| `trpc` | `@silkweave/trpc` | `packages/trpc/src/adapter/trpc.ts` | Standalone tRPC HTTP server (`@trpc/server/adapters/standalone`) with fully-typed `AppRouter` inference |
| `trpcFetch` | `@silkweave/trpc` | `packages/trpc/src/adapter/fetch.ts` | Fetch-compatible tRPC handler (`@trpc/server/adapters/fetch`) for Astro/Vercel/Cloudflare serverless runtimes |
| `cli` | `@silkweave/cli` | `packages/cli/src/adapter/cli.ts` | CLI via `commander` with plain `console` output |
| `edge` | `@silkweave/edge` | `packages/edge/src/adapter/edge.ts` | Stateless MCP Streamable HTTP (`WebStandardStreamableHTTPServerTransport`) |
| `mcp` | `@silkweave/nestjs` | `packages/nestjs/src/adapter/mcp.ts` | Exposes existing NestJS controller routes (`@Mcp` methods, discovered via `DiscoveryService`) as MCP tools mounted on Nest's HTTP server; tool schemas reflected from route + param decorators + swagger/class-validator |
| `trpc` | `@silkweave/nestjs` | `packages/nestjs/src/adapter/trpc.ts` | Exposes `@Trpc`-decorated controller routes as tRPC procedures (httpBatch query/mutation + SSE subscription) mounted on Nest's HTTP server via `createExpressMiddleware`; reuses `@silkweave/trpc`'s `buildRouter`; guards read the real Express request (cookie/header auth) and denials carry `data.httpStatus` |
| `typegen` | `@silkweave/nestjs` | `packages/nestjs/src/adapter/typegen.ts` | Writes the `AppRouter` type (`TRPCBuiltRouter`) for every `@Trpc` procedure on boot, via `@silkweave/typegen`'s `renderTypegen`; gated to `@Trpc` actions only |
| `defineSilkweave` | `@silkweave/nextjs` | `packages/nextjs/src/lib/defineSilkweave.ts` | Next.js App Router. `defineSilkweave({ actions })` returns `app.mcp()` / `app.trpc()`, each building Next route handlers (`{ GET, POST, ... }`) by wrapping `@silkweave/edge` (MCP) and `@silkweave/trpc`'s `trpcFetch` respectively; `typeof app.Router` carries the typed `AppRouter` for the tRPC client |
| `typegen` | `@silkweave/typegen` | `packages/typegen/src/adapter/typegen.ts` | Build-time `.d.ts` generation from action Zod schemas (`allActions: true`) |

MCP adapters (`stdio`, `http`) register actions as MCP tools using `PascalCase` names (via the shared `registerTools()`). **Two integration primitives** let Silkweave drop into an existing app: the **Node** handler `mcpTransport().post` (an Express `RequestHandler`, for express / fastify / NestJS) and the **Web-Standard** handler `edge().handler` (a `(Request) => Response`, for hono / Next.js / Cloudflare / Deno / Bun - express-free). The CLI adapter uses `kebab-case` for commands and maps Zod types to CLI options/arguments. The `typegen` adapter uses `allActions: true` to bypass `isEnabled` filtering and generate types for all registered actions. The `trpc` adapter registers each action as a tRPC procedure at `camelCase(action.name)`, dispatching `action.kind` to `.query()` or `.mutation()`; the exported `InferTrpcRouter<typeof server>` type extracts a fully-typed `AppRouter` for `createTRPCClient<AppRouter>()`.

### Key Utilities (in @silkweave/core)

- `unwrap()` in `packages/core/src/util/zod.ts` - recursively unwraps Zod wrapper types (optional, nullable, default, readonly) to get the base type and metadata. Used by the CLI adapter for option generation.
- `createLogger()` / `buildLogLevels()` / `createConsoleLogger()` and the `Logger`/`LogLevel` types in `packages/core/src/util/logger.ts` (part of **`@silkweave/core`** - there is no separate logger package; the logger is the shape of the `context.get('logger')` key every action receives, so it belongs to core and adds **zero dependencies**). `createLogger()` is a structured logger that writes JSON lines to a stream (default `process.stdout`, `false` to discard), honoring a `level` threshold and `onLog`/`onProgress` callbacks; it is the default logger forked into the action context by the `stdio`/`http`/`edge` MCP adapters (`stream: false` or `process.stderr`, with `onLog` forwarding to MCP `notifications/message`). `buildLogLevels()` builds a log-level record from a single callback (used by the `fastify`/`trpc` adapters to bridge onto their host loggers).
- `createConsoleLogger()` in the same module - a zero-dependency, human-readable `console`-backed logger (each syslog level mapped to `console.log`/`info`/`warn`/`error`), used by `@silkweave/cli` and `@silkweave/mcp`'s cliProxy for terminal output. There is **no terminal-UI dependency** (`@clack/prompts` was dropped): a core-only consumer (e.g. the `@Mcp()` decorator import path in `@silkweave/nestjs`) pulls neither pino nor clack.
- `isStreamingAction(action)` in `packages/core/src/util/action.ts` - returns `true` when `action.run` is an `async function*`. Every adapter checks this at registration time to branch between buffered and streaming code paths.
- `lintActions(actions)` / `reportActionLint(actions, warn?)` in `packages/core/src/util/lint.ts` - dev-time **ecosystem guardrail** flagging agent-hostile action definitions (missing / throwaway `description`, undescribed input params) - the cheap mistakes that quietly degrade an agent's tool-use. `silkweave().start()` runs `reportActionLint` automatically (warnings to stderr via `console.warn`, safe for stdio); disable with `SilkweaveOptions.lint: false`.
- HTTP routing helpers in `packages/core/src/util/http.ts` - used by `@silkweave/fastify`. `actionMethod(action)` resolves the HTTP verb (`method` ?? `GET` for queries ?? `POST`); `methodHasBody(method)` is `true` for everything except `GET`; `pathParamNames(path)` extracts `:param` names; `validateActionRouting(action)` throws a `SilkweaveError` at registration time if a path placeholder or `queryParams` entry is not a key of the input schema; `resolveActionInput(action, { params, query, body })` merges the three sources (body base layer, then declared query params, then path params) and coerces path/query strings to the primitive each field's schema expects, returning the object to feed `action.input.parse()`.
- `ToolCallEvent` / `OnToolCall` / `emitToolCall()` in `packages/core/src/util/telemetry.ts` - the per-invocation telemetry contract. `emitToolCall()` invokes a hook **fire-and-forget** (never awaited on the call path; sync throws and async rejections logged to stderr and swallowed). MCP adapters accept `onToolCall` (option on `stdio()`/`http()`/`mcpTransport()`/`edge()`) and emit from `registerTools()` **after result formatting**, so MCP events carry `resultBytes` (serialized raw-result size) and `sideloaded` (smart embedded-resource offload); `ok` is false on a thrown error (`errorCode` = `SilkweaveError.code`, else the error's name) or an `isError` tool result. `@silkweave/nestjs` wires telemetry via DI: `forRoot({ telemetry: ClassToken })` (a `SilkweaveTelemetry` provider, resolved via `ModuleRef` lazily at first event) - MCP events come from the registrar seam, tRPC events from the synthesized action wrapper in `ControllerDiscovery` (gated to the `trpc` adapter context; guard denials count as failed calls) - **exactly one event per call** on either transport.
- `runStreamingAction(action, input, context, onChunk?)` in `packages/core/src/util/streaming.ts` - drives a streaming action's async generator, awaiting `onChunk` for each yielded value before pulling the next (which is how transport-level backpressure - SSE drain, stdout drain, MCP notification ack - flows back to the action). Returns the buffered array of chunks; the buffered fallback is used when a client opts out of streaming (e.g. no MCP `progressToken`, or a `POST` without an SSE/NDJSON `Accept` header in Fastify).

### Streaming

A streaming action declares a `chunk` Zod schema (instead of, or alongside, `output`) and an `async function*` `run`:

```typescript
createAction({
  name: 'generate-messages',
  description: '...',
  input: z.object({ count: z.number() }),
  chunk: z.object({ index: z.number(), text: z.string() }),
  run: async function* ({ count }, { logger }) {
    for (let i = 0; i < count; i += 1) {
      yield { index: i, text: `Message ${i}` }
    }
  }
})
```

Each adapter delivers chunks differently:

| Adapter | Wire format | Trigger | Fallback |
|---------|-------------|---------|----------|
| `stdio()`, `http()`, `edge()` (MCP) | `notifications/progress` with the JSON-stringified chunk in `message` and a 1-based `progress` counter | Client sends `_meta.progressToken` in the tool call | Action runs to completion, chunks are buffered and returned as the final `CallToolResult` |
| `fastify()` (REST) | `text/event-stream` (SSE: `data: <json>\n\n`, terminated by `event: done`) or `application/x-ndjson` (one JSON chunk per line) | `Accept` header matches `text/event-stream` or `application/x-ndjson` | `200 OK` with the buffered chunk array in the response body |
| `trpc()`, `trpcFetch()` | Action is registered as a tRPC `.subscription()` whose async generator yields chunks directly | Streaming action ⇒ always a subscription (regardless of `kind`) | n/a - the consumer iterates the subscription |
| `cli()` | NDJSON on stdout (one JSON chunk per line, backpressure-aware via `stdout.write` + `drain`) | Streaming action ⇒ always streamed | n/a |

**MCP and AI host visibility.** Standard MCP `notifications/progress` puts each chunk on the wire correctly, but what the host client does with those notifications is a host-side choice. Most LLM hosts today (Claude Code, Cursor, generic chat UIs) consume progress notifications for *UI rendering* - spinners, status text, progress bars - while the model still sees only the final aggregated tool result when the call returns. Chunks reach the wire; in-flight model visibility depends on whether the host surfaces them into the model's context. For per-chunk model visibility today, prefer Fastify (SSE/NDJSON) or tRPC subscriptions.

### REST routing

The `@silkweave/fastify` REST adapter maps a single input schema across the HTTP request's path, query string, and body using three optional action fields:

```typescript
createAction({
  name: 'list.users',
  kind: 'query',                       // ⇒ method defaults to GET
  method: 'GET',                       // explicit verb (overrides the kind default)
  path: 'spaces/:spaceId/users',       // :spaceId resolved from the URL path
  queryParams: ['offset', 'limit'],    // read from ?offset=&limit= instead of the body
  input: z.object({
    spaceId: z.string(),               // ← path param
    offset: z.int().optional().default(0),  // ← query param (coerced + defaulted)
    limit: z.int().optional().default(10)   // ← query param
  }),
  run: async ({ spaceId, offset, limit }) => { /* ... */ }
})
```

- **`method`** - `'GET' | 'POST' | 'PUT' | 'DELETE'`. Defaults to `POST`, or `GET` when `kind: 'query'`. An explicit `method` always wins.
- **`path`** - route template joined to the adapter's base (Fastify mounts at `/`). `:param` placeholders are matched from the URL path. When unset, the path is derived from `name` (Fastify uses the name verbatim).
- **`queryParams`** - input fields sourced from the query string on body-carrying methods. On a bodyless `GET`, *every* non-path input field is read from the query string automatically.

Field-source precedence when merging: body (base) → declared query params → path params (highest). Path/query values arrive as strings and are coerced to the schema's primitive (number/boolean/bigint). Fastify validates the result via per-source JSON Schema (AJV) route schemas (and surfaces failures as `400 validation_error`). Misconfigured routing (a `:param` or `queryParams` entry absent from the input schema) throws at registration via `validateActionRouting()`.

> **NestJS note:** `@silkweave/nestjs` does **not** use these core routing fields. It goes the other direction - reflecting a controller method's existing `@Get`/`@Post` + `@Param`/`@Query`/`@Body` decorators into a tool input schema (see [NestJS Utilities](#nestjs-utilities-in-silkweavenestjs)).

### Vercel AI SDK Integration (in @silkweave/ai)

`@silkweave/ai` bridges Vercel AI SDK's `useChat` hook to a Silkweave streaming action over tRPC subscriptions - skipping AI SDK's Data Stream Protocol entirely. The chunks `useChat` consumes are plain JS objects, so a custom `ChatTransport` doesn't need to emit the prefix-coded wire format; it just needs to produce a `ReadableStream<UIMessageChunk>` from whatever transport you choose.

- `createChatAction({ model, system?, tools?, ... })` in `packages/ai/src/chatAction.ts` - server-side helper. Wraps `streamText()` from `ai` in a Silkweave streaming action; `chunk` schema is `z.custom<UIMessageChunk>()` and `run` is an async generator that yields chunks from `result.toUIMessageStream()`. Combined with the tRPC adapter, this automatically registers as a `.subscription()` procedure.
- `silkweaveTransport(subscribe)` in `packages/ai/src/transport.ts` - client-side `ChatTransport` factory. Wraps a subscribe-style function (typically `client.chat.subscribe`) into a `ReadableStream<UIMessageChunk>` that `useChat` consumes directly. Abort signals propagate to `unsubscribe()`. `reconnectToStream` returns `null` - stream resume after disconnect is intentionally unsupported (would require server-side state we don't manage).
- `onData` is typed as `unknown` at the callback boundary because Zod's `z.custom<UIMessageChunk>()` doesn't preserve the exact union variance through tRPC's subscription type inference (`input?: unknown` vs `input: unknown`). Runtime is safe because the server only yields valid chunks; the cast lives in the transport.
- `examples/ai/` is the canonical end-to-end example: Vite + React + `useChat` → custom transport → tRPC subscription → `createChatAction` → Anthropic's Claude via `@ai-sdk/anthropic`. Server loads `ANTHROPIC_API_KEY` from `examples/ai/.env` via `dotenv`.

### tRPC Utilities (in @silkweave/trpc)

- `InferTrpcRouter<S>` in `packages/trpc/src/lib/inferRouter.ts` - type helper that extracts a `TRPCBuiltRouter` type from a `Silkweave<Actions>` instance. Maps each action to a `TRPCQueryProcedure` or `TRPCMutationProcedure` keyed by `camelCase(action.name)`, with input/output types inferred from the Zod schemas and the `run()` return type. The `Silkweave<Actions>` generic preserves literal action names and kinds through `.action()` calls, so `typeof server` carries the router shape.
- `buildRouter(actions)` in `packages/trpc/src/lib/buildRouter.ts` - runtime counterpart to `InferTrpcRouter`. Builds the tRPC router from an `Action[]` array using `initTRPC.context<TrpcHandlerContext>().create()`. Shared by both `trpc()` (standalone HTTP) and `trpcFetch()` (fetch handler).
- `createActionLogger()` / `resolveAuth()` in `packages/trpc/src/lib/createContext.ts` - shared helpers for the per-request silkweave context (logger injection and optional bearer-token validation). Used by both tRPC adapters.
- `trpcFetch(options?)` in `packages/trpc/src/adapter/fetch.ts` - returns `{ adapter, handler, GET, POST }` for Web Standard runtimes (Astro, Vercel serverless, Cloudflare Workers). The internal `_ready` promise gates the handler until `server.start()` has built the router, guarding against cold-start races. CORS must be handled by the host framework.
- `mapError(error)` in `packages/trpc/src/lib/errors.ts` - converts `SilkweaveError` (via `statusCode`), `ZodError` (to `BAD_REQUEST`), or any other thrown value to a `TRPCError` with the appropriate code.

### MCP Result Utilities (in @silkweave/mcp)

- `smartToolResult()` in `packages/mcp/src/util/result.ts` - opt-in response formatter (`disposition: 'smart'`; was the default before 3.2). Responses ≤ 4096 chars are returned as `TextContent` JSON; larger payloads are automatically split into a short text summary + base64 embedded resource to reduce LLM context bloat.
- `jsonToolResult()` / `errorToolResult()` / `handleToolError()` in `packages/mcp/src/util/result.ts` - lower-level helpers for constructing `CallToolResult` objects (`jsonToolResult` is the default formatter since 3.2). Used internally by all MCP adapters and available for custom `toolResult` hooks.
- `structuredToolResult()` in `packages/mcp/src/util/result.ts` - `structuredContent` + JSON text mirror for `disposition: 'structured'` actions. Callers must pass the output-schema-**parsed** data (zod strips extra fields), never the raw result - that is what keeps the SDK's client-side JSON-Schema validation (`additionalProperties: false`) passing by construction; a genuine mismatch degrades to an `isError` tool result naming the failing fields (exempt from SDK output validation) instead of a protocol error.
- `buildMcpExpressApp()` in `packages/mcp/src/adapter/http.ts` + `mcpTransport()` in `packages/mcp/src/handlers/transport.ts` - `buildMcpExpressApp()` wires the full Express app (MCP transport + OAuth + sideload + well-known routes) for the server-owning `http()` adapter; `mcpTransport()` returns the stateless `POST /mcp` handler and is the primitive **shared** by `http()` and `@silkweave/nestjs`'s `mcp()` (which mounts it, plus `oauthRoutes()`/`protectedResourceMetadata()`, onto Nest's HTTP server).
- `filterActions` per-request tool filtering (`packages/mcp/src/handlers/filter.ts`, option on `http()`/`mcpTransport()`/`edge()`/nestjs `mcp()`) - `(actions, request) => Action[] | Promise<Action[]>` runs before `registerTools()` on every POST (the stateless transport recomputes the tool list per request, so permission changes apply on the next `tools/list`; applies to `tools/call` too, so a client that cached a wider list is still denied). The `FilterRequest` stand-in is `{ headers, url, method, toolName? }` - `method` is the JSON-RPC method extracted by `rpcInfo()` (lets the filter skip lookups on `initialize`/`ping` and doubles as an observability tap), `toolName` is `params.name` on `tools/call`. JSON-RPC **batches are rejected** by both stateless transports (`http()` and `edge()`) with a `400` before the filter runs (batching was removed from the MCP spec, and a batch would otherwise let a later message bypass a filter keyed on the first), so `method`/`toolName` always reflect a single message. **Error semantics** (`filterErrorResponse()`): a thrown `SilkweaveError` propagates as its `statusCode` with a JSON-RPC error body, anything else maps to 500 - a throw NEVER degrades to an empty tool list. Exported from both the package root and the express-free `@silkweave/mcp/tools` subpath (edge imports it from there).
- `registerTools()` in `packages/mcp/src/handlers/registerTools.ts` - **shared by all MCP transports** (`stdio`, `http`, `edge`). Forks the per-tool-call action context with `logger`, `extra` (the SDK `RequestHandlerExtra`), optional `auth` (from `authStorage`), and a `request` key. The `request` is a `{ headers, url, params, query, body }` stand-in built from `extra.requestInfo` (`requestFromExtra()`), surfacing the inbound tool-call HTTP headers under the same context key REST/tRPC populate - this is what lets `@silkweave/nestjs` `@UseGuards` guards read request headers over MCP. There are no path `params`/`query`/`body` on an MCP call, so those start empty (the `@silkweave/nestjs` guard layer later fills `params` from the reflected path bindings - see NestJS Utilities below). A `logStream` option keeps `stdio` logging to `false` (stdout is the protocol channel) while HTTP transports use `process.stderr`; the result is formatted by the action's `toolResult` hook or the resolved `disposition` (`_meta.disposition` > `action.disposition` > `smart`).

### NestJS Utilities (in @silkweave/nestjs)

The `@silkweave/nestjs` model is **additive controller reflection**: add `@Mcp()` (MCP) or `@Trpc()` (tRPC) to an existing controller route and it becomes a tool / procedure. Nothing is re-declared - the name/description/input are reflected from metadata the method already carries. The discovery/reflection core is transport-neutral; both decorators share it, and a method can carry both (yielding two gated actions).

- `@Mcp(options)` (`packages/nestjs/src/decorator/mcp.ts`) - method decorator marking a controller route for MCP exposure. Options (all optional): `name`, `description`, `input` (a Zod override merged over reflected fields - a raw shape `{ field: z.ZodType }` **or** a whole `z.object({ ... })`, whose `.shape` is duck-typed-unwrapped via `inputShape()`; it *adds to* reflected fields, never replaces them), `pipes: 'apply' | 'skip'`, `result: 'json' | 'smart' | 'structured'` (MCP result format - sets the synthesized action's `disposition`; a client `_meta.disposition` overrides `'json'`/`'smart'` but never `'structured'`), `output` (explicit output schema backing `result: 'structured'` - Zod type, DTO class, or raw shape; wins over `@Trpc({ output })`; `'structured'` **boot-errors without an explicit output** - reflected `@ApiOkResponse` schemas are deliberately rejected as structured contracts), `annotations` (MCP `ToolAnnotations` merged over verb-derived defaults: `@Get` ⇒ read-only + idempotent, `@Put` ⇒ idempotent, `@Delete` ⇒ destructive + idempotent, else `{ readOnlyHint: false }`), `tags` (free-form grouping labels carried on the synthesized action for the `mcp({ filterActions })` per-request filter). Stored via `SetMetadata(MCP_METADATA, ...)`. A module-wide default is also available via `SilkweaveModuleOptions.defaultResult` (`'json' | 'smart'` - `'structured'` is deliberately per-method only); precedence is **client `_meta.disposition` > `@Mcp({ result })` > module `defaultResult` > `'json'`** (was `'smart'` before 3.2; threaded through `ControllerDiscovery.discover()` → each action's `disposition`).
- `@Trpc(options)` (`packages/nestjs/src/decorator/trpc.ts`) - the tRPC sibling, stored via `SetMetadata(TRPC_METADATA, ...)`. Options (all optional): `name`, `description`, `input` (same as `@Mcp`), plus tRPC-specific ones - `output` (a Zod type, DTO class, or raw shape driving the generated procedure's output type; wins over `@ApiOkResponse` reflection), `chunk` (a Zod type or DTO class typing a subscription's `async *` stream), `kind` (`'query' | 'mutation' | 'subscription'`; inferred from verb (`@Get`⇒query, else mutation) or `async *` body (⇒subscription) when unset), `pipes`. Works **without** an HTTP-verb decorator (so a verb-less route is served over tRPC/MCP but not mapped as public REST). Procedure keys are `camelCase(`${ControllerBase}.${MethodName}`)` (e.g. `Users.listBySpace` → `usersListBySpace`).
- `ControllerDiscovery` (`packages/nestjs/src/lib/controllerDiscovery.ts`) - walks every provider **and controller** via `DiscoveryService` + `MetadataScanner`, finds methods carrying `@Mcp` and/or `@Trpc`, and `reflect()`s the shared input/bindings/guards **once** per method, then emits a synthesized core `Action` per decorator present. `reflect()` also `logger.warn`s (via a `new Logger('Silkweave')`) any **unreflectable whole-DTO param** - a `@Body()`/`@Query()` that reflected to zero fields, e.g. an intersection/union TypeScript erases to `Object`/`Array` under `design:type` (the silent-drop footgun; a `({ input })` override does not recover the dropped fields). `mcpAction()` gates `isEnabled` to the `mcp` adapter; `trpcAction()` gates to `trpc`/`typegen`, infers `kind`, resolves `output` (`@Trpc({ output })` → `@ApiOkResponse` reflection via `reflectResponseSchema`/`reflectDtoSchema`) and warns (`outputDegradedFields()` over `reflectResponseFields()` + `unreflectedFields()`) when a **reflected** output field degrades to `unknown`/`unknown[]` (nested DTO / `Dto[]`); it converts thrown Nest `HttpException`s to `SilkweaveError` (so `@silkweave/trpc`'s `mapError` yields the right `TRPCError` code + `data.httpStatus`). An `async *` method becomes a streaming action (`run` is an `async function*` that applies guards then yields the method's chunks) for both targets - tRPC registers it as a `.subscription()`, MCP buffers/streams via progress.
- `reflect/response.ts` (`packages/nestjs/src/lib/reflect/response.ts`) - `reflectResponseSchema(method)` reads `@nestjs/swagger`'s `swagger/apiResponse` metadata (via the shared `successEntry()`), picks the 2xx entry's `type`, and flattens that DTO into a Zod object (array-wrapped when `isArray`); `reflectResponseFields(method)` returns the same DTO's `FieldDesc` map (no schema) so `trpcAction` can flag degraded fields; `reflectDtoSchema(dtoType)` reflects any DTO class via `reflectDtoFields`. Reflection is **one level deep** - nested DTOs / `Dto[]` degrade to `unknown`/`unknown[]` (detected by `schema.ts`'s `unreflectedFields()` and warned at boot); supply `@Trpc({ output })` a Zod schema for a precise nested shape.
- **Entry split + optional peers** (footprint) - the package has **subpath exports** so importing the root (`@silkweave/nestjs`: module + `@Mcp`/`@Trpc` decorators + discovery/reflection) pulls only `@silkweave/core` + zod (no MCP SDK, no `@trpc/server`). Each adapter is its own entry/subpath: `@silkweave/nestjs/mcp` (`mcp()`), `@silkweave/nestjs/trpc` (`trpc()`), `@silkweave/nestjs/typegen` (`typegen()`), built as separate tsdown entries (`src/{index,mcp,trpc,typegen}.ts`) that code-split the shared core. `@silkweave/mcp`, `@silkweave/trpc`, `@silkweave/typegen`, and `@trpc/server` are **optional `peerDependencies`** (like `@nestjs/swagger`/`class-validator`), so an MCP-only app never installs the tRPC stack and vice versa. `rxjs` is a (required) peer too - it must be externalized, not bundled, or guards' `isObservable()`/`instanceof` checks would break against the host's rxjs. The `typegen()` adapter additionally **lazy-`import()`s** `@silkweave/typegen` inside `register()` so the TS compiler loads only when that adapter runs.
- Reflection core (`packages/nestjs/src/lib/reflect/`) - `route.ts` composes the controller prefix + method path + verb (Nest `PATH_METADATA`/`METHOD_METADATA`) into a `:param`/`{param}` route + path-param list; `params.ts` reads `ROUTE_ARGS_METADATA` (`@Param`/`@Query`/`@Body`/...) into per-argument slots; `schema.ts` is the converter hub - a transport-neutral `FieldDesc` intermediate, a `fieldToZod()` builder (honors a `nullable` `FieldDesc` flag - sourced from `@ApiProperty({ nullable: true })` / OpenAPI `nullable` - via `.nullable()`; `class-validator` has no nullable signal so `@IsOptional` stays optional-not-nullable), per-source mappers (swagger `@ApiParam`/`@ApiProperty`, class-validator, `design:type`, OpenAPI schema), `reflectDtoFields()` for whole-DTO params, and `unreflectedFields()` (names of fields that fell back to `unknown`); `swagger.ts` reads operation-level `@ApiOperation`/`@ApiParam`/`@ApiQuery`; `openapi.ts` ingests an optional OpenAPI document (matched by verb + path, `$ref`-resolving); `classValidator.ts` lazily `createRequire`s the optional `class-validator` peer (from this package or the app cwd) and reads its metadata storage (built-ins record identity in `meta.name`, e.g. `minLength`, `isString`; `@IsOptional` in `meta.type`). Per-field merge precedence: `design:type` < class-validator < swagger decorators < OpenAPI doc < `@Mcp({ input })`.
- `rebind.ts` (`packages/nestjs/src/lib/rebind.ts`) - `invokeRebound()` reconstructs the method's positional args from the flat tool input per the discovery-time `Binding[]` plan (scalar field, whole-DTO object, path-params object, or `@Req`/`@Headers`/`@Ip` sourced from the request stand-in, plus `@Res` sourced from the forked `response`), runs parameter-bound pipes (unless `pipes: 'skip'`), then `method.apply(instance, args)`. `@Res()` resolves to the **real Express response over tRPC** (the `trpc()` adapter forks `response: res` into the context, so `@Res({ passthrough: true })` can set session cookies/headers) and to `undefined` over MCP (no HTTP response). Globally-registered `ValidationPipe`/interceptors/exception filters do **not** run - only guards and param-bound pipes.
- `runGuards()` / `collectGuards()` / `collectGlobalGuards()` (`packages/nestjs/src/lib/guards.ts`) - `collectGuards` merges `@UseGuards()` metadata from class+method; `collectGlobalGuards` reads the app's global guards from the injected `ApplicationConfig` (`getGlobalGuards()` for `useGlobalGuards(new X())` instances + `getGlobalRequestGuards()` `.instance` for `{ provide: APP_GUARD, useClass }` DI guards) and filters them against an opt-in allow-list of classes (`SilkweaveModuleOptions.globalGuards`); `runGuards` resolves guard instances via `ModuleRef` and runs `canActivate()` against a `SilkweaveExecutionContext`. `applyGuards` (in `controllerDiscovery.ts`) resolves global guards **at call time** (APP_GUARD instances aren't populated until `app.init()`), runs them before the method/class guards, and reads `request`/`response` from the silkweave context (MCP-over-HTTP populates `request` from `extra.requestInfo`), passing `contextType: 'http'` when a request exists and `'rpc'` otherwise. A header-reading guard (`switchToHttp().getRequest().headers['x-api-key']`) sees the inbound tool-call headers; with no request it gets a header-less stand-in so it denies instead of crashing. Over **tRPC** the `request`/`response` forked into the context are the **real Express req/res** (the `trpc()` adapter's `createContext` forks them in), so a guard reading cookies/`req.user` works exactly as in REST - unlike MCP there is a genuine HTTP request. Before running guards, `applyGuards` also reconstructs `request.params`/`query`/`body` from the validated input per the reflected param sources (`requestSlotFields()` routes each input field: path/`@Param` -> `params`, `@Query` -> `query`, `@Body` -> `body`; whole-DTO `@Query()`/`@Body()` contribute all their fields), `populateRequestSlots()` filling each slot - path/query stringified to match how Express delivers them, body kept as parsed values - and only filling keys not already present (so a real REST/tRPC request's own slots are never overwritten). This makes a scope-enforcing guard reading `getRequest().params['id']` (e.g. OpenWA's `allowedSessions` API-key scoping), `req.query['…']`, or `req.body['…']` decide identically over MCP and REST - the request-fidelity contract that lets host auth run transport-transparently. The allow-list is explicit-by-class rather than "all globals" because unrelated globals (e.g. `ThrottlerGuard`, which needs a writable response) would misbehave over MCP.

### Next.js Utilities (in @silkweave/nextjs)

The `@silkweave/nextjs` model is **action-first projection** (the inverse of NestJS's reflection): Next.js route handlers carry no reflectable schema metadata, so instead of reading existing handlers, you define Silkweave Actions once and project them onto Next.js **App Router** route files. The package is a thin, Next-specific wrapper over `@silkweave/edge` (MCP) and `@silkweave/trpc` (`trpcFetch`) - it adds path normalization, ergonomic route factories, and end-to-end tRPC types. App Router only; the package has **no `next`/`react` dependency** (handlers are Web-Standard `(request: Request) => Promise<Response>`).

- `defineSilkweave({ name, description, version, actions })` (`packages/nextjs/src/lib/defineSilkweave.ts`) - returns a `SilkweaveApp` with `.mcp(options)`, `.trpc(options)`, and a type-only `Router` phantom. Generic over the actions tuple (`const Arr`), so `typeof app.Router` resolves via `InferTrpcRouter` to a fully-typed `AppRouter` for `createTRPCClient` - no manual `typeof server` plumbing. `.mcp()`/`.trpc()` each build their **own** internal `silkweave(identity).actions(actions).adapter(...)` instance (no shared-mutable-builder footgun), `void`-start it (the adapters' `_ready` promise guards cold starts), and return `{ GET, POST, ... }`.
- `buildMcpRoute()` (`packages/nextjs/src/lib/mcpRoute.ts`) - wires actions through `edge()` and wraps its handler with `rewriteRequestPath()`. Returns `{ GET, POST, DELETE, OPTIONS }` for a single optional-catch-all file `app/<basePath>/[[...slug]]/route.ts`.
- `buildTrpcRoute()` (`packages/nextjs/src/lib/trpcRoute.ts`) - wires actions through `trpcFetch()` (which strips its own `endpoint`, so no rewrite needed). Returns `{ GET, POST, OPTIONS }`; CORS is opt-in (`cors: true`) since a same-origin Next.js frontend needs none.
- `normalizeBasePath()` / `rewriteRequestPath()` (`packages/nextjs/src/lib/stripPrefix.ts`) - the key glue. `@silkweave/edge` matches **absolute** pathnames (`/mcp`, `/authorize`, `/token`, `/.well-known/...`), but a Next route is mounted under a fixed prefix. `rewriteRequestPath(request, basePath)` strips `basePath` from the incoming URL (`/api/mcp` → `/mcp`, `/api/mcp/authorize` → `/authorize`, `/api/mcp/.well-known/...` → `/.well-known/...`), reconstructing the `Request` (preserving method/headers/body, with `duplex: 'half'` for streaming bodies) so one catch-all file serves the transport + OAuth + protected-resource metadata. `basePath` **must** equal the route file's directory (no reliable way to detect the mount at module load). Recommend `runtime = 'nodejs'` + `dynamic = 'force-dynamic'` in route files.

## Tooling

> Make sure to use the `roam` MCP server when exploring the codebase.

- One `roam` command replaces 5-10 grep/read cycles. Always try roam first.
- Use `roam search` instead of grep/glob for finding symbols - it understands
  definitions vs. usage and ranks by importance.
- `roam context` gives exact line ranges - more precise than reading whole files.
- After `git pull`, run `roam index` to keep the graph fresh.
- For disambiguation, use `file:symbol` syntax: `roam symbol myfile:MyClass`.

### Code Quality Metrics

**Do NOT use `roam health` as a quality metric** for this project. It penalizes
architectural patterns that are correct for a multi-package library toolkit
(adapter hubs → bottlenecks, disconnected packages → low connectivity,
public API exports → "dead" symbols).

Use these instead:
- `roam fitness` - metric thresholds + trend guards in `.roam/fitness.yaml` (CI-friendly, exit 1 on failure)
- `roam rules --ci` - custom architecture rules in `.roam/rules/` (layer violations, adapter isolation)
- `roam check-rules --profile minimal` - built-in structural rules with false-positive-prone checks excluded
- `roam complexity --threshold 15` - function-level cognitive complexity
- `roam vibe-check` - AI rot score (target: < 10)
- `roam ai-readiness` - agent-friendliness score
- `roam trends --save` - save a snapshot after each release for trend guards

### Roam in Sub-Agents

All `mcp__roam-code__*` tools are available inside sub-agents (both `general-purpose` and `Explore` types). When spawning a sub-agent for codebase exploration, include these instructions in the prompt:

> Use `mcp__roam-code__*` MCP tools for codebase exploration. Prefer roam over
> grep/glob/read - it understands symbols, call graphs, and architecture.
> Key tools: `roam_understand` (overview), `roam_context` (files for a symbol),
> `roam_search_symbol` (find by name), `roam_trace` (dependency paths),
> `roam_file_info` (file structure), `roam_impact` (blast radius).
> Use ToolSearch to find the full tool schemas before calling them.

## Code Style

- ESM-only (`"type": "module"` in package.json)
- No semicolons, single quotes, 2-space indent, no trailing commas
- Unused vars must be prefixed with `_`
- Imports use `.js` extensions (NodeNext module resolution)
- Zod v4 (`zod@^4.3.6`)
- Always avoid Em-Dash (`—`), use regular dash instead, or ideally avoid altogether (comments, markdown, docs, website)

## Package resolution (dev source vs. published build)

Each publishable package (`packages/*`, except the `silkweave` umbrella) resolves to **build output for everyone except our own tooling**, while in-repo tooling resolves to **TS source** - so cross-package edits need no rebuild, but external installs/`pnpm link`/registry consumers always get `build/`:

```jsonc
"main": "./build/index.mjs",
"types": "./build/index.d.mts",          // matches tsdown's emitted .d.mts (NOT .d.ts)
"exports": {
  ".": {
    "@silkweave/source": "./src/index.ts", // custom condition - ONLY our tooling enables it
    "types": "./build/index.d.mts",
    "default": "./build/index.mjs"         // external consumers land here
  }
}
```

- The condition is the **custom name `@silkweave/source`**, not the generic `development` - the latter is auto-enabled by Vite/Vitest, which would silently leak our raw `.ts` source to external consumers. A custom name is opt-in only.
- Our tooling enables it explicitly: tsconfig `"customConditions": ["@silkweave/source"]` (every package + example tsconfig); `tsx --conditions=@silkweave/source …` and `node --conditions=@silkweave/source …` in example dev scripts; `resolve.conditions` in the Vite/Astro configs (`examples/ai/vite.config.ts`, `website/astro.config.mjs`).
- There is **no `publishConfig`** - the resolved `main`/`types`/`exports` above are correct as-published; `pnpm pack` ships them verbatim.
- **When adding a new package**, copy this `main`/`types`/`exports` block and add `"customConditions": ["@silkweave/source"]` to its tsconfig.

## Wrapup Config

- check: `pnpm check` - always run from the **repo root** (not from a sub-package), so turbo runs lint + typecheck across every workspace package
- test: `pnpm test` - runs `turbo test` (Vitest) across every package that defines a `test` script. New `*.test.ts` files co-locate in a package's `src/` (never shipped - tsdown builds only its explicit entries) and resolve cross-package `@silkweave/*` imports to TS source via the shared `vitest.shared.ts` (the `@silkweave/source` condition). To add Vitest to a package without it: `pnpm -F <pkg> add -D vitest`, add a one-line `vitest.config.ts` re-exporting `sharedConfig`, a `"test": "vitest run"` script, and `vitest.config.ts` to the eslint `ignores`.
- push: yes
- version_bump: yes (aligned across all packages)
  + `pnpm -r exec npm version 1.9.0 --no-git-tag-version --force`
- publish: yes (automated via GitHub Actions - **do not run `pnpm publish` locally**). Pushing a `vX.Y.Z` tag triggers `.github/workflows/publish.yml`, which builds, lints, and publishes every public package to npm via OIDC trusted publishing (`pnpm publish -r`). See [CI/CD](#cicd) below. The local `pnpm publish:all` script remains only as a manual fallback.
- docs: per-package README.md + root CLAUDE.md as index + website docs page
- frontend_smoke: N/A
- changelog: yes - on every version bump, **prepend a new entry to `website/src/data/changelog.ts`** (the single source of truth; newest first; short user-facing highlights with commit hashes), then run `pnpm sync-releases` after the `vX.Y.Z` tag is pushed to create/update the matching GitHub release. The website `/changelog` page and GitHub releases must stay in sync - both render from that one data file.
- extra: Update our website (landing page and docs) with new or changed features

## Docs Checklist

When making changes to features, APIs, or architecture, update docs in **all three layers**:

1. **CLAUDE.md** (root) - architecture overview, key utilities, package inventory
2. **Per-package README.md** - API reference, usage examples, options tables
3. **Website docs** (`website/src/pages/docs.astro`) - user-facing documentation including code examples, Action interface, adapter reference, and sidebar nav (`website/src/layouts/DocsLayout.astro`)

## Changelog & Releases

The website `/changelog` page (`website/src/pages/changelog.astro`) and the GitHub releases are both generated from one canonical data file, **`website/src/data/changelog.ts`** (pure data, no imports - so the release-sync script can import it too):

- **On each release**, prepend a `Release` entry (newest first). Keep highlights short and user-facing ("what's new at a glance"); set each change's `type` (`breaking | feature | improvement | fix`) and a short `commit` hash for the GitHub deep-dive link. A pre-tag/POC entry can set `unreleased: true` (rendered without a release link, skipped by the sync script). Major (`X.0.0`) releases render with a highlighted frame automatically.
- **`pnpm sync-releases`** (`scripts/sync-releases.ts`, run via `tsx`) reads that file and creates/updates a GitHub release per `vX.Y.Z` tag (idempotent; notes grouped by change type; the newest entry is marked `--latest`). Requires the `vX.Y.Z` tags to be pushed first; `--dry-run` prints the notes without touching GitHub.
- Release tags follow `vX.Y.Z` and must be pushed (`git push --tags`); every tagged version should have a matching GitHub release.
- Pushing the `vX.Y.Z` tag also triggers the **publish workflow** ([CI/CD](#cicd)) - the tag push is what publishes the packages to npm, so create the tag only on a commit that already contains `.github/workflows/publish.yml`.

## CI/CD

Two GitHub Actions workflows live in `.github/workflows/`:

- **`ci.yml`** - runs on every push to `master` and every pull request. Installs (`--frozen-lockfile`), builds, then runs `pnpm exec turbo lint check` (lint + typecheck across all workspace packages) followed by `pnpm exec turbo test` (the Vitest suites). It deliberately does **not** run the root `pnpm check`'s trailing `pnpm roam` step, since the roam CLI isn't available on CI runners.
- **`publish.yml`** - runs when a `vX.Y.Z` tag is pushed. Builds, lints, tests, then runs `pnpm publish -r --access public --no-git-checks`. Publishing uses **npm trusted publishing (OIDC)** - there is **no `NPM_TOKEN`**; auth comes from the `id-token: write` permission, and npm auto-generates provenance attestations.

Key facts for maintaining the publish flow:

- **Trusted publisher config is per-package on npmjs.com** (one-time, manual): each package's Settings → Trusted Publisher → GitHub Actions points at org `silkweave`, repo `silkweave`, workflow `publish.yml`, allowed action `npm publish`. A newly added package must be configured there (and have an initial version) before the workflow can publish it.
- **pnpm version matters**: pnpm's OIDC publishing regressed in 11.0.8 and was fixed in **11.1.0** (drops the unresolved `${NODE_AUTH_TOKEN}` placeholder that `actions/setup-node` writes). The repo pins `pnpm@11.1.1` via `packageManager`, which `pnpm/action-setup@v4` picks up automatically - do not pin pnpm to <= 11.0.8 or trusted publishing breaks.
- `pnpm publish -r` skips versions already on the registry, so re-running a tag is safe (idempotent).
- A tag must point at a commit that **contains `publish.yml`** - GitHub runs a tag's workflow from the tagged commit. (When first enabling this, the pre-existing `v2.5.0` tag had to be force-moved onto the commit that introduced the workflow.)
