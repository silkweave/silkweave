# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

Silkweave is a TypeScript toolkit for building MCP (Model Context Protocol) servers and CLI tools from a single set of "Actions". Define an action once, then expose it via multiple adapters (MCP stdio, MCP HTTP, Fastify REST API, or CLI).

## Commands

```bash
pnpm build          # Build all packages with tsdown (ESM output to build/)
pnpm check          # Lint + typecheck all packages
pnpm clean          # Clean all build outputs and turbo cache

# Run example servers (not automated tests - these start live servers)
pnpm tsx example/src/stdio.ts    # MCP stdio server
pnpm tsx example/src/http.ts     # MCP streamable HTTP server on :8080
pnpm tsx example/src/fastify.ts  # Fastify REST API with Swagger on :8080
pnpm tsx example/src/http-auth.ts # MCP HTTP with bearer token auth on :8080
pnpm tsx example/src/http-oauth.ts # MCP HTTP with Google OAuth 2.1 on :8080
pnpm tsx example/src/cli.ts      # CLI mode

# MCP Inspector (connects to example stdio via .mcp.json)
pnpm mcp
```

## Architecture

The core pattern is **Action → Adapter → Silkweave**:

- **Action** (`packages/core/src/util/action.ts`): A named operation with a Zod input schema and an async `run(input, context)` function. Actions are adapter-agnostic - they receive a `Logger` via context. An optional `toolResult(response, context)` hook lets actions control how results are formatted as MCP `CallToolResult` (e.g. returning embedded resources for large payloads).
- **Adapter** (`packages/core/src/util/adapter.ts`): Translates actions into a specific transport. `AdapterFactory<T>` takes config options, returns an `AdapterGenerator` that takes `SilkweaveOptions` and produces an `Adapter` with `start(actions)` / `stop()`.
- **Silkweave** (`packages/core/src/lib/silkweave.ts`): Fluent builder - `silkweave(opts).adapter(generator).action(action).start()`.

### Packages

| Package | Path | Description |
|---------|------|-------------|
| `@silkweave/core` | `packages/core` | Core library - actions, adapters, builder, context, logger, utilities |
| `@silkweave/auth` | `packages/auth` | Auth - OAuth 2.1 proxy (PKCE, refresh tokens, CIMD, dynamic client registration), bearer token validation, protected resource metadata (RFC 9728) |
| `@silkweave/mcp` | `packages/mcp` | MCP adapters - stdio, streamable HTTP, CLI proxy |
| `@silkweave/cli` | `packages/cli` | CLI adapter - commander + clack terminal UI |
| `@silkweave/fastify` | `packages/fastify` | Fastify REST adapter - auto-generated OpenAPI/Swagger docs |
| `@silkweave/vercel` | `packages/vercel` | Vercel serverless adapter - stateless MCP over Streamable HTTP |
| `@silkweave/typegen` | `packages/typegen` | Type generator - emits `.d.ts` interfaces from action Zod schemas using the TypeScript compiler API |
| `@silkweave/examples` | `example` | Example usage of all adapters |

### Adapters

| Adapter | Package | File | Transport |
|---------|---------|------|-----------|
| `stdio` | `@silkweave/mcp` | `packages/mcp/src/adapter/stdio.ts` | MCP over stdin/stdout (`StdioServerTransport`) |
| `http` | `@silkweave/mcp` | `packages/mcp/src/adapter/http.ts` | MCP Streamable HTTP (`express` + session management) |
| `cliProxy` | `@silkweave/mcp` | `packages/mcp/src/adapter/cliProxy.ts` | MCP CLI proxy client (`commander` + `StreamableHTTPClientTransport`) |
| `fastify` | `@silkweave/fastify` | `packages/fastify/src/adapter/fastify.ts` | REST API with Swagger UI via `@scalar/fastify-api-reference` |
| `cli` | `@silkweave/cli` | `packages/cli/src/adapter/cli.ts` | CLI via `commander` with `@clack/prompts` output |
| `vercel` | `@silkweave/vercel` | `packages/vercel/src/adapter/vercel.ts` | Stateless MCP Streamable HTTP (`WebStandardStreamableHTTPServerTransport`) |
| `typegen` | `@silkweave/typegen` | `packages/typegen/src/adapter/typegen.ts` | Build-time `.d.ts` generation from action Zod schemas (`allActions: true`) |

MCP adapters (`stdio`, `http`) register actions as MCP tools using `PascalCase` names. The CLI adapter uses `kebab-case` for commands and maps Zod types to CLI options/arguments. The `typegen` adapter uses `allActions: true` to bypass `isEnabled` filtering and generate types for all registered actions.

### Key Utilities (in @silkweave/core)

- `unwrap()` in `packages/core/src/util/zod.ts` - recursively unwraps Zod wrapper types (optional, nullable, default, readonly) to get the base type and metadata. Used by the CLI adapter for option generation.
- `buildLogLevels()` in `packages/core/src/util/logger.ts` - builds a log-level record from a single callback function.
- `buildCLILogger()` / `parseCLIInput()` / `handleCLIError()` in `packages/core/src/util/cli.ts` - CLI logging and input parsing utilities shared by `@silkweave/cli` and `@silkweave/mcp`'s cliProxy.

### MCP Result Utilities (in @silkweave/mcp)

- `smartToolResult()` in `packages/mcp/src/util/result.ts` - default response formatter. Responses ≤ 4096 chars are returned as `TextContent` JSON; larger payloads are automatically split into a short text summary + base64 embedded resource to reduce LLM context bloat.
- `jsonToolResult()` / `errorToolResult()` / `handleToolError()` in `packages/mcp/src/util/result.ts` - lower-level helpers for constructing `CallToolResult` objects. Used internally by all MCP adapters and available for custom `toolResult` hooks.

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

- check: `pnpm check`
- test: skip
- push: yes
- version_bump: yes (aligned across all packages)
  + `pnpm -r exec pnpm version x.x.x --no-git-tag-version`
- publish: yes (manual - prompt to run `! pnpm publish:all`)
- docs: per-package README.md + root CLAUDE.md as index + website docs page
- frontend_smoke: N/A

## Docs Checklist

When making changes to features, APIs, or architecture, update docs in **all three layers**:

1. **CLAUDE.md** (root) - architecture overview, key utilities, package inventory
2. **Per-package README.md** - API reference, usage examples, options tables
3. **Website docs** (`website/src/pages/docs.astro`) - user-facing documentation including code examples, Action interface, adapter reference, and sidebar nav (`website/src/layouts/DocsLayout.astro`)
