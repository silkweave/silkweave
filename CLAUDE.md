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
pnpm -F @silkweave/example-cli dev         # CLI adapter (commander + clack)
pnpm -F @silkweave/example-mcp stdio       # MCP stdio server
pnpm -F @silkweave/example-mcp http        # MCP streamable HTTP server on :8080
pnpm -F @silkweave/example-mcp http-auth   # MCP HTTP with bearer token auth on :8080
pnpm -F @silkweave/example-mcp http-oauth  # MCP HTTP with Google OAuth 2.1 on :8080
pnpm -F @silkweave/example-mcp cli-proxy   # MCP CLI proxy client (connects to http example)
pnpm -F @silkweave/example-fastify dev     # Fastify REST API with Swagger on :8080
pnpm -F @silkweave/example-trpc dev        # tRPC standalone HTTP server on :8080/trpc/
pnpm -F @silkweave/example-typegen dev     # Generate .d.ts from action Zod schemas
pnpm -F @silkweave/example-nestjs dev      # NestJS controllers exposed as MCP tools via @Mcp, on :8080

# AI chat example (Vite + React + useChat + tRPC subscriptions)
ANTHROPIC_API_KEY=sk-... pnpm -F @silkweave/example-ai dev

# MCP Inspector (connects to MCP stdio example via .mcp.json)
pnpm mcp
```

## Architecture

The core pattern is **Action → Adapter → Silkweave**:

- **Action** (`packages/core/src/util/action.ts`): A named operation with a Zod `input` schema, an optional Zod `output` schema, and an async `run(input, context)` function. Actions are adapter-agnostic - they receive a `Logger` via context. The `output` schema is used by the typegen and tRPC adapters to generate typed response interfaces. An optional `kind: 'query' | 'mutation'` field (default `'mutation'`) controls how the action is exposed over tRPC - queries are GET-cacheable, mutations are POST. the `@silkweave/fastify` REST adapter additionally honors three optional routing fields: `method` (`'GET' | 'POST' | 'PUT' | 'DELETE'`, default `POST` or `GET` when `kind: 'query'`), `path` (a route template that may contain `:param` placeholders, e.g. `'spaces/:spaceId/users'`), and `queryParams` (input fields read from the URL query string instead of the body, e.g. `['offset', 'limit']`). Path placeholders and query params must be keys of the input schema; the input is merged from path + query + body and validated as one (see [REST routing](#rest-routing) below). An optional `toolResult(response, context)` hook lets actions control how results are formatted as MCP `CallToolResult` (e.g. returning embedded resources for large payloads). `Action<I, O, N, K>` is generic over input/output types, the literal `name`, and `kind` - literal types are preserved through `createAction()` so the `Silkweave<Actions>` builder can thread action types to type-aware adapters like tRPC. Actions can also be **streaming**: declare a `chunk` Zod schema and an `async function*` `run` that yields chunks; adapters detect this via `isStreamingAction()` and switch to per-chunk wire delivery (see [Streaming](#streaming) below).
- **Adapter** (`packages/core/src/util/adapter.ts`): Translates actions into a specific transport. `AdapterFactory<T>` takes config options, returns an `AdapterGenerator` that takes `SilkweaveOptions` and produces an `Adapter` with `start(actions)` / `stop()`.
- **Silkweave** (`packages/core/src/lib/silkweave.ts`): Fluent builder - `silkweave(opts).adapter(generator).action(action).start()`. `Silkweave<Actions extends Record<string, Action>>` is generic over accumulated actions so `typeof server` carries action type info forward; type-aware adapters (e.g. `@silkweave/trpc`'s `InferTrpcRouter<typeof server>`) extract this for end-to-end type safety.

### Packages

| Package | Path | Description |
|---------|------|-------------|
| `@silkweave/core` | `packages/core` | Core library - actions, adapters, builder, context, logger, utilities |
| `@silkweave/auth` | `packages/auth` | Auth - OAuth 2.1 proxy (PKCE, refresh tokens, CIMD, dynamic client registration), bearer token validation, protected resource metadata (RFC 9728) |
| `@silkweave/mcp` | `packages/mcp` | MCP adapters - stdio, streamable HTTP, CLI proxy |
| `@silkweave/cli` | `packages/cli` | CLI adapter - commander + clack terminal UI |
| `@silkweave/fastify` | `packages/fastify` | Fastify REST adapter - auto-generated OpenAPI/Swagger docs |
| `@silkweave/trpc` | `packages/trpc` | tRPC adapter - end-to-end type-safe procedures via `InferTrpcRouter<typeof server>` |
| `@silkweave/vercel` | `packages/vercel` | Vercel serverless adapter - stateless MCP over Streamable HTTP |
| `@silkweave/nestjs` | `packages/nestjs` | NestJS adapter - the `@Mcp` method decorator exposes existing controller routes as MCP tools; tool input schemas are reflected from the route + `@Param`/`@Query`/`@Body` decorators + `@nestjs/swagger`/`class-validator` metadata (+ optional OpenAPI doc); on a tool call the input is re-bound into the method's positional args (guards applied first) |
| `@silkweave/typegen` | `packages/typegen` | Type generator - emits `.d.ts` interfaces from action Zod schemas using the TypeScript compiler API |
| `@silkweave/ai` | `packages/ai` | Vercel AI SDK bridge - `createChatAction()` wraps `streamText` into a streaming action; `silkweaveTransport()` is a custom `ChatTransport` that adapts any subscribe-style function (typically a tRPC subscription) into the `ReadableStream<UIMessageChunk>` that `useChat` consumes |
| `@silkweave/example-*` | `examples/*` | One example per adapter package: `examples/core`, `examples/cli`, `examples/mcp`, `examples/fastify`, `examples/trpc`, `examples/typegen`, `examples/vercel`, `examples/nestjs`. Each is a self-contained workspace package with its own `package.json`, `tsconfig.json`, `eslint.config.mjs`, and minimal inline actions. |
| `@silkweave/example-ai` | `examples/ai` | End-to-end chat app: Vite + React + `useChat` → `silkweaveTransport` → tRPC subscription → Silkweave streaming action → AI SDK `streamText`. Run with `pnpm -F @silkweave/example-ai dev` (needs `ANTHROPIC_API_KEY`). |

### Adapters

| Adapter | Package | File | Transport |
|---------|---------|------|-----------|
| `stdio` | `@silkweave/mcp` | `packages/mcp/src/adapter/stdio.ts` | MCP over stdin/stdout (`StdioServerTransport`) |
| `http` | `@silkweave/mcp` | `packages/mcp/src/adapter/http.ts` | MCP Streamable HTTP (`express` + session management) |
| `cliProxy` | `@silkweave/mcp` | `packages/mcp/src/adapter/cliProxy.ts` | MCP CLI proxy client (`commander` + `StreamableHTTPClientTransport`) |
| `fastify` | `@silkweave/fastify` | `packages/fastify/src/adapter/fastify.ts` | REST API with Swagger UI via `@scalar/fastify-api-reference` |
| `trpc` | `@silkweave/trpc` | `packages/trpc/src/adapter/trpc.ts` | Standalone tRPC HTTP server (`@trpc/server/adapters/standalone`) with fully-typed `AppRouter` inference |
| `trpcFetch` | `@silkweave/trpc` | `packages/trpc/src/adapter/fetch.ts` | Fetch-compatible tRPC handler (`@trpc/server/adapters/fetch`) for Astro/Vercel/Cloudflare serverless runtimes |
| `cli` | `@silkweave/cli` | `packages/cli/src/adapter/cli.ts` | CLI via `commander` with `@clack/prompts` output |
| `vercel` | `@silkweave/vercel` | `packages/vercel/src/adapter/vercel.ts` | Stateless MCP Streamable HTTP (`WebStandardStreamableHTTPServerTransport`) |
| `mcp` | `@silkweave/nestjs` | `packages/nestjs/src/adapter/mcp.ts` | Exposes existing NestJS controller routes (`@Mcp` methods, discovered via `DiscoveryService`) as MCP tools mounted on Nest's HTTP server; tool schemas reflected from route + param decorators + swagger/class-validator |
| `typegen` | `@silkweave/typegen` | `packages/typegen/src/adapter/typegen.ts` | Build-time `.d.ts` generation from action Zod schemas (`allActions: true`) |

MCP adapters (`stdio`, `http`) register actions as MCP tools using `PascalCase` names. The CLI adapter uses `kebab-case` for commands and maps Zod types to CLI options/arguments. The `typegen` adapter uses `allActions: true` to bypass `isEnabled` filtering and generate types for all registered actions. The `trpc` adapter registers each action as a tRPC procedure at `camelCase(action.name)`, dispatching `action.kind` to `.query()` or `.mutation()`; the exported `InferTrpcRouter<typeof server>` type extracts a fully-typed `AppRouter` for `createTRPCClient<AppRouter>()`.

### Key Utilities (in @silkweave/core)

- `unwrap()` in `packages/core/src/util/zod.ts` - recursively unwraps Zod wrapper types (optional, nullable, default, readonly) to get the base type and metadata. Used by the CLI adapter for option generation.
- `buildLogLevels()` in `packages/core/src/util/logger.ts` - builds a log-level record from a single callback function.
- `buildCLILogger()` / `parseCLIInput()` / `handleCLIError()` in `packages/core/src/util/cli.ts` - CLI logging and input parsing utilities shared by `@silkweave/cli` and `@silkweave/mcp`'s cliProxy.
- `isStreamingAction(action)` in `packages/core/src/util/action.ts` - returns `true` when `action.run` is an `async function*`. Every adapter checks this at registration time to branch between buffered and streaming code paths.
- HTTP routing helpers in `packages/core/src/util/http.ts` - used by `@silkweave/fastify`. `actionMethod(action)` resolves the HTTP verb (`method` ?? `GET` for queries ?? `POST`); `methodHasBody(method)` is `true` for everything except `GET`; `pathParamNames(path)` extracts `:param` names; `validateActionRouting(action)` throws a `SilkweaveError` at registration time if a path placeholder or `queryParams` entry is not a key of the input schema; `resolveActionInput(action, { params, query, body })` merges the three sources (body base layer, then declared query params, then path params) and coerces path/query strings to the primitive each field's schema expects, returning the object to feed `action.input.parse()`.
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
| `stdio()`, `http()`, `vercel()` (MCP) | `notifications/progress` with the JSON-stringified chunk in `message` and a 1-based `progress` counter | Client sends `_meta.progressToken` in the tool call | Action runs to completion, chunks are buffered and returned as the final `CallToolResult` |
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

- `smartToolResult()` in `packages/mcp/src/util/result.ts` - default response formatter. Responses ≤ 4096 chars are returned as `TextContent` JSON; larger payloads are automatically split into a short text summary + base64 embedded resource to reduce LLM context bloat.
- `jsonToolResult()` / `errorToolResult()` / `handleToolError()` in `packages/mcp/src/util/result.ts` - lower-level helpers for constructing `CallToolResult` objects. Used internally by all MCP adapters and available for custom `toolResult` hooks.
- `createMcpExpressHandler()` in `packages/mcp/src/lib/handler.ts` - builds the Express sub-app exposing MCP Streamable HTTP, OAuth routes, and bearer-token auth. Shared by `http()` (server-owning) and `@silkweave/nestjs`'s `mcp()` (mounts on Nest's HTTP server).
- `registerTools()` in `packages/mcp/src/handlers/transport.ts` - forks the per-tool-call action context with `logger`, `extra` (the SDK `RequestHandlerExtra`), optional `auth`, and a `request` key. The `request` is a `{ headers, url, params, query }` stand-in built from `extra.requestInfo` (`requestFromExtra()`), surfacing the inbound tool-call HTTP headers under the same context key REST/tRPC populate - this is what lets `@silkweave/nestjs` `@UseGuards` guards read request headers over MCP. There are no path `params`/`query` on an MCP call, so those start empty (the `@silkweave/nestjs` guard layer later fills `params` from the reflected path bindings - see NestJS Utilities below).

### NestJS Utilities (in @silkweave/nestjs)

The `@silkweave/nestjs` model is **additive controller reflection**: add `@Mcp()` to an existing controller route and it becomes an MCP tool. Nothing is re-declared - the tool's name/description/input are reflected from metadata the method already carries. `@Mcp` is MCP-only; a `@Trpc` sibling for tRPC is planned, so the discovery/reflection core is transport-neutral.

- `@Mcp(options)` (`packages/nestjs/src/decorator/mcp.ts`) - method decorator marking a controller route for MCP exposure. Options (all optional): `name`, `description`, `input` (a Zod raw-shape override merged over reflected fields), `pipes: 'apply' | 'skip'`. Stored via `SetMetadata(MCP_METADATA, ...)`.
- `ControllerDiscovery` (`packages/nestjs/src/lib/controllerDiscovery.ts`) - walks every provider **and controller** via `DiscoveryService` + `MetadataScanner`, and for each `@Mcp` method builds one synthesized core `Action`: a flat Zod `input` (merged from all metadata sources) and a `run` that applies guards then re-binds the validated input into the method's positional arguments. Sets `isEnabled` to gate the action to the `mcp` adapter.
- Reflection core (`packages/nestjs/src/lib/reflect/`) - `route.ts` composes the controller prefix + method path + verb (Nest `PATH_METADATA`/`METHOD_METADATA`) into a `:param`/`{param}` route + path-param list; `params.ts` reads `ROUTE_ARGS_METADATA` (`@Param`/`@Query`/`@Body`/...) into per-argument slots; `schema.ts` is the converter hub - a transport-neutral `FieldDesc` intermediate, a `fieldToZod()` builder, per-source mappers (swagger `@ApiParam`/`@ApiProperty`, class-validator, `design:type`, OpenAPI schema), and `reflectDtoFields()` for whole-DTO params; `swagger.ts` reads operation-level `@ApiOperation`/`@ApiParam`/`@ApiQuery`; `openapi.ts` ingests an optional OpenAPI document (matched by verb + path, `$ref`-resolving); `classValidator.ts` lazily `createRequire`s the optional `class-validator` peer (from this package or the app cwd) and reads its metadata storage (built-ins record identity in `meta.name`, e.g. `minLength`, `isString`; `@IsOptional` in `meta.type`). Per-field merge precedence: `design:type` < class-validator < swagger decorators < OpenAPI doc < `@Mcp({ input })`.
- `rebind.ts` (`packages/nestjs/src/lib/rebind.ts`) - `invokeRebound()` reconstructs the method's positional args from the flat tool input per the discovery-time `Binding[]` plan (scalar field, whole-DTO object, path-params object, or `@Req`/`@Headers`/`@Ip` sourced from the MCP request stand-in), runs parameter-bound pipes (unless `pipes: 'skip'`), then `method.apply(instance, args)`. Globally-registered `ValidationPipe`/interceptors/exception filters do **not** run - only guards and param-bound pipes.
- `runGuards()` / `collectGuards()` / `collectGlobalGuards()` (`packages/nestjs/src/lib/guards.ts`) - `collectGuards` merges `@UseGuards()` metadata from class+method; `collectGlobalGuards` reads the app's global guards from the injected `ApplicationConfig` (`getGlobalGuards()` for `useGlobalGuards(new X())` instances + `getGlobalRequestGuards()` `.instance` for `{ provide: APP_GUARD, useClass }` DI guards) and filters them against an opt-in allow-list of classes (`SilkweaveModuleOptions.globalGuards`); `runGuards` resolves guard instances via `ModuleRef` and runs `canActivate()` against a `SilkweaveExecutionContext`. `applyGuards` (in `controllerDiscovery.ts`) resolves global guards **at call time** (APP_GUARD instances aren't populated until `app.init()`), runs them before the method/class guards, and reads `request`/`response` from the silkweave context (MCP-over-HTTP populates `request` from `extra.requestInfo`), passing `contextType: 'http'` when a request exists and `'rpc'` otherwise. A header-reading guard (`switchToHttp().getRequest().headers['x-api-key']`) sees the inbound tool-call headers; with no request it gets a header-less stand-in so it denies instead of crashing. Before running guards, `applyGuards` also populates `request.params` from the reflected path bindings (`pathParamFields()` reads `kind:'params'` + `source:'path'` bindings) using the validated input - as raw strings, only filling keys not already present - so a path-scoped guard (`getRequest().params['id']`, e.g. OpenWA's `allowedSessions` API-key scoping) behaves identically to REST over MCP. `query` is still left empty (no real query string over MCP). The allow-list is explicit-by-class rather than "all globals" because unrelated globals (e.g. `ThrottlerGuard`, which needs a writable response) would misbehave over MCP.

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
- test: skip
- push: yes
- version_bump: yes (aligned across all packages)
  + `pnpm -r exec npm version 1.9.0 --no-git-tag-version --force`
- publish: yes (manual - prompt to run `! pnpm publish:all`)
- docs: per-package README.md + root CLAUDE.md as index + website docs page
- frontend_smoke: N/A
- extra: Update our website (landing page and docs) with new or changed features

## Docs Checklist

When making changes to features, APIs, or architecture, update docs in **all three layers**:

1. **CLAUDE.md** (root) - architecture overview, key utilities, package inventory
2. **Per-package README.md** - API reference, usage examples, options tables
3. **Website docs** (`website/src/pages/docs.astro`) - user-facing documentation including code examples, Action interface, adapter reference, and sidebar nav (`website/src/layouts/DocsLayout.astro`)
