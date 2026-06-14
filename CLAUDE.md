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
pnpm -F @silkweave/example-nestjs dev      # NestJS server (REST + tRPC + MCP) on :8080

# AI chat example (Vite + React + useChat + tRPC subscriptions)
ANTHROPIC_API_KEY=sk-... pnpm -F @silkweave/example-ai dev

# MCP Inspector (connects to MCP stdio example via .mcp.json)
pnpm mcp
```

## Architecture

The core pattern is **Action → Adapter → Silkweave**:

- **Action** (`packages/core/src/util/action.ts`): A named operation with a Zod `input` schema, an optional Zod `output` schema, and an async `run(input, context)` function. Actions are adapter-agnostic - they receive a `Logger` via context. The `output` schema is used by the typegen and tRPC adapters to generate typed response interfaces. An optional `kind: 'query' | 'mutation'` field (default `'mutation'`) controls how the action is exposed over tRPC - queries are GET-cacheable, mutations are POST. An optional `toolResult(response, context)` hook lets actions control how results are formatted as MCP `CallToolResult` (e.g. returning embedded resources for large payloads). `Action<I, O, N, K>` is generic over input/output types, the literal `name`, and `kind` - literal types are preserved through `createAction()` so the `Silkweave<Actions>` builder can thread action types to type-aware adapters like tRPC. Actions can also be **streaming**: declare a `chunk` Zod schema and an `async function*` `run` that yields chunks; adapters detect this via `isStreamingAction()` and switch to per-chunk wire delivery (see [Streaming](#streaming) below).
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
| `@silkweave/nestjs` | `packages/nestjs` | NestJS adapter - method/class decorators (`@Action`, `@Actions`) discovered via DI, mounted as REST/tRPC/MCP routes on Nest's HTTP server |
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
| `rest`, `trpc`, `mcp` | `@silkweave/nestjs` | `packages/nestjs/src/adapter/{rest,trpc,mcp}.ts` | NestJS adapters that mount on Nest's HTTP server; `@Action` methods discovered via `DiscoveryService` |
| `typegen` | `@silkweave/typegen` | `packages/typegen/src/adapter/typegen.ts` | Build-time `.d.ts` generation from action Zod schemas (`allActions: true`) |

MCP adapters (`stdio`, `http`) register actions as MCP tools using `PascalCase` names. The CLI adapter uses `kebab-case` for commands and maps Zod types to CLI options/arguments. The `typegen` adapter uses `allActions: true` to bypass `isEnabled` filtering and generate types for all registered actions. The `trpc` adapter registers each action as a tRPC procedure at `camelCase(action.name)`, dispatching `action.kind` to `.query()` or `.mutation()`; the exported `InferTrpcRouter<typeof server>` type extracts a fully-typed `AppRouter` for `createTRPCClient<AppRouter>()`.

### Key Utilities (in @silkweave/core)

- `unwrap()` in `packages/core/src/util/zod.ts` - recursively unwraps Zod wrapper types (optional, nullable, default, readonly) to get the base type and metadata. Used by the CLI adapter for option generation.
- `buildLogLevels()` in `packages/core/src/util/logger.ts` - builds a log-level record from a single callback function.
- `buildCLILogger()` / `parseCLIInput()` / `handleCLIError()` in `packages/core/src/util/cli.ts` - CLI logging and input parsing utilities shared by `@silkweave/cli` and `@silkweave/mcp`'s cliProxy.
- `isStreamingAction(action)` in `packages/core/src/util/action.ts` - returns `true` when `action.run` is an `async function*`. Every adapter checks this at registration time to branch between buffered and streaming code paths.
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
| `@silkweave/nestjs` `trpc()` | Same as `trpc()` above - an `async function*` `@Action` (with a `chunk` schema) is discovered as a streaming core action and registered as a tRPC `.subscription()` | Decorated method is an `async function*` | n/a |

**MCP and AI host visibility.** Standard MCP `notifications/progress` puts each chunk on the wire correctly, but what the host client does with those notifications is a host-side choice. Most LLM hosts today (Claude Code, Cursor, generic chat UIs) consume progress notifications for *UI rendering* - spinners, status text, progress bars - while the model still sees only the final aggregated tool result when the call returns. Chunks reach the wire; in-flight model visibility depends on whether the host surfaces them into the model's context. For per-chunk model visibility today, prefer Fastify (SSE/NDJSON) or tRPC subscriptions.

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
- `registerTools()` in `packages/mcp/src/handlers/transport.ts` - forks the per-tool-call action context with `logger`, `extra` (the SDK `RequestHandlerExtra`), optional `auth`, and a `request` key. The `request` is a `{ headers, url, params, query }` stand-in built from `extra.requestInfo` (`requestFromExtra()`), surfacing the inbound tool-call HTTP headers under the same context key REST/tRPC populate - this is what lets `@silkweave/nestjs` `@UseGuards` guards read request headers over MCP. There are no path `params`/`query` on an MCP call, so those are empty.

### NestJS Utilities (in @silkweave/nestjs)

- `@Action(options)` (`packages/nestjs/src/decorator/action.ts`) - method decorator that registers an Action on a Nest provider. Compiles `transports[]` allowlist into the core `Action.isEnabled` mechanism.
- `@Actions(prefix?)` (`packages/nestjs/src/decorator/actions.ts`) - class decorator that prefixes every method-level action name. Accepts `string` shorthand or `{ prefix, transports }`.
- `ActionDiscovery` (`packages/nestjs/src/lib/discovery.ts`) - walks every Nest provider via `DiscoveryService` + `MetadataScanner`, builds core `Action[]` from `@Action` metadata, wraps each invocation with guard resolution. Detects `async function*` methods (`d.method.constructor?.name === 'AsyncGeneratorFunction'`) and builds a **streaming** core action (guards run inside the generator before the first `yield`, so `isStreamingAction()` is true and the trpc/typegen adapters expose it as a subscription); requires a `chunk` schema and throws at discovery time if absent.
- `runGuards()` (`packages/nestjs/src/lib/guards.ts`) - reads `@UseGuards()` metadata from method+class, resolves guard instances via `ModuleRef`, runs `canActivate()` against a `SilkweaveExecutionContext`. Transport-aware: `applyGuards` (in `discovery.ts`) reads `request`/`response` from the silkweave context (populated by REST/tRPC, and by MCP-over-HTTP from `extra.requestInfo` - see below), passing `contextType: 'http'` when a request exists and `'rpc'` otherwise. Transports with no HTTP request (e.g. MCP stdio) get a header-less request stand-in so header-reading guards deny instead of crashing. So `@UseGuards` works on **all** transports including MCP, where a guard reading `switchToHttp().getRequest().headers['x-api-key']` sees the inbound tool-call headers.
- `reserveSlot()` (`packages/nestjs/src/lib/slot.ts`) - mounts a placeholder middleware on Nest's HTTP server during `OnModuleInit` (before Nest's 404 catch-all is installed) and returns a setter callback used in `OnApplicationBootstrap` to populate the real handler. This is the key to the adapter's lifecycle correctness.

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
