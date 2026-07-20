// Canonical changelog data - the single source of truth for both the website
// changelog page (`src/pages/changelog.astro`) and the GitHub releases created
// by `scripts/sync-releases.ts`. Keep it pure data (no imports) so the Node
// sync script can import it directly via tsx.
//
// On each release, prepend a new entry here (newest first). Keep highlights
// short and user-facing - "what's new at a glance", not a commit dump. Link a
// highlight to its commit via the short hash so readers can deep-dive.

export const REPO_URL = 'https://github.com/silkweave/silkweave'

/** A single user-facing change within a release. */
export interface Change {
  /** Drives the badge label/colour: New / Improved / Fixed / Breaking. */
  type: 'feature' | 'improvement' | 'fix' | 'breaking'
  /** One concise line - what changed, in user terms. */
  text: string
  /** Short commit hash for a GitHub deep-dive link (optional). */
  commit?: string
}

/** One released version. */
export interface Release {
  /** Semver, no leading `v` (the `v` tag is derived). */
  version: string
  /** ISO date `YYYY-MM-DD` of the release. */
  date: string
  /** Optional one-line framing for the release (shown under the version). */
  summary?: string
  /** Ordered highlights - breaking first, then features, improvements, fixes. */
  changes: Change[]
  /**
   * No `vX.Y.Z` git tag / GitHub release backs this entry (e.g. a pre-tag
   * prototype). The page renders it without a release link and the
   * release-sync script skips it.
   */
  unreleased?: boolean
}

export const releases: Release[] = [
  {
    version: '5.0.0',
    date: '2026-07-21',
    summary: 'Skills over MCP: serve Agent Skills (SKILL.md) from any Silkweave MCP server - versioned, digest-verified, installable with one command - and the silkweave package becomes the CLI that installs them.',
    changes: [
      {
        type: 'breaking',
        text: 'The silkweave npm package is now the Silkweave CLI, not an umbrella of re-exports: the silkweave/core, silkweave/mcp, ... subpaths are gone. Depend on the scoped packages (@silkweave/core, @silkweave/mcp, ...) directly.',
        commit: 'e71d427'
      },
      {
        type: 'feature',
        text: 'Serve Agent Skills over MCP: a skills option on stdio()/http()/mcpTransport()/edge() serves each SKILL.md directory three ways at once - skill:// file resources (the SEP-2640 baseline), ListSkills/GetSkill tools every current client can call, and a server-instructions pointer that activates the skills in hosts. Per-request filterActions gates the whole surface: hiding the skill tools also hides the resources and instructions.',
        commit: 'e71d427'
      },
      {
        type: 'feature',
        text: 'The silkweave CLI: npx silkweave skills sync|install|list|outdated|pin|unpin installs digest-verified skills into ~/.claude/skills (or --target) with a lockfile recording server, versions, and per-file sha256 digests - every file re-verified client-side, names/paths revalidated so a server can never write outside the target. Plus npx silkweave proxy <url>: any MCP server as a CLI on the spot.',
        commit: 'e71d427'
      },
      {
        type: 'feature',
        text: 'Claude Code plugin bridge for public skills: silkweave skills pack wraps a skill into a skills-only plugin package for npm (refusing versions already on the registry), and the skillsMarketplace option serves /.claude-plugin/marketplace.json with npm-sourced entries - consumers get native /plugin install and /plugin update.',
        commit: 'ecc1fc9'
      },
      {
        type: 'feature',
        text: 'Multi-skill plugins: skills pack <dir...> bundles several skills into one plugin package, and skills served with a shared npmPackage collapse into a single marketplace entry named after the package - the published @silkweave/example-plugin (both demo skills from examples/skills) is the live demo.',
        commit: '3758eb4'
      },
      {
        type: 'feature',
        text: 'EXPERIMENTAL SEP-2640 extension: skillsExtension: true additionally serves the draft skills/list + skills/get methods and the capability declaration; the CLI auto-consumes the extension where declared, so skills sync also installs from conforming third-party servers (e.g. Hugging Face MCP). Off by default while the draft churns.',
        commit: 'f93c8fe'
      },
      {
        type: 'improvement',
        text: 'MCP servers now pass initialize instructions when serving skills (the working-group-validated activation pattern), and @silkweave/skills is a lazy-loaded optional peer - the option costs nothing when unused.',
        commit: 'e71d427'
      }
    ]
  },
  {
    version: '4.4.0',
    date: '2026-07-20',
    summary: 'Binary resources: one action can now return a screenshot, PDF, or JSON artifact - delivered as an MCP image block the model can see, raw bytes over REST, a typed envelope over tRPC, and a file (or clean pipe) from the CLI.',
    changes: [
      {
        type: 'feature',
        text: 'Resource results: declare output: binary({ mimeType, name?, description? }) and return resource(bytes, ...), a Web-Standard File/Blob, or bare Uint8Array/ArrayBuffer bytes - every adapter detects the resource and delivers it transport-appropriately. Everything is Web-Standard (no Buffer), so resource actions run on edge runtimes.',
        commit: 'd3d75e8'
      },
      {
        type: 'feature',
        text: 'MCP mime-driven content blocks: the resource description ships first as a text block, raster image/* becomes an image block multimodal hosts surface to the model (agents literally see the screenshot), audio/* an audio block, text media (JSON, markdown, SVG) an embedded resource with text, and other binary an embedded base64 blob. A client _meta.disposition cannot demote a resource result.',
        commit: 'd3d75e8'
      },
      {
        type: 'feature',
        text: 'REST + CLI delivery: the Fastify adapter responds with raw bytes (Content-Type, Content-Disposition filename, Content-Description) and documents format: binary in OpenAPI; cli()/cliProxy pipe raw bytes on stdout, add an -o/--output flag, and never dump binary onto an interactive terminal.',
        commit: 'd3d75e8'
      },
      {
        type: 'feature',
        text: 'tRPC + typegen envelope: JSON-only transports ship a SerializedResource envelope ({ kind, mimeType, name?, description?, text? | base64? }), typed end-to-end through InferTrpcRouter and the generated .d.ts/AppRouter.',
        commit: 'd3d75e8'
      },
      {
        type: 'feature',
        text: '@silkweave/nestjs resource routes: @Mcp({ resource })/@Trpc({ resource }) declare a controller route\'s result a resource; a reflected non-JSON @Header(\'Content-Type\', ...) flips an existing endpoint automatically with a bare @Mcp(), and returned StreamableFiles are collected to bytes (explicit type/disposition wins as a named resource).',
        commit: 'd3d75e8'
      }
    ]
  },
  {
    version: '4.3.0',
    date: '2026-07-20',
    summary: 'cliProxy grows up: authenticate against gated MCP servers without monkey-patching fetch, and let tools declare CLI positional arguments that cross the wire.',
    changes: [
      {
        type: 'feature',
        text: 'cliProxy auth passthrough: headers (a record or a lazy sync/async thunk resolved once per invocation), requestInit, fetch, and authProvider are forwarded to the SDK\'s StreamableHTTPClientTransport - no more globalThis.fetch monkey-patching to send a bearer token.',
        commit: 'dbaf296'
      },
      {
        type: 'feature',
        text: 'Positional CLI arguments over the wire: Action.args is published in the MCP tool\'s _meta as silkweave/args (spec-legal, ignored by other clients) and cliProxy renders those fields as positionals in declared order - required as <arg>, optional as [arg]. @silkweave/nestjs gains the matching @Mcp({ args }) option, boot-validated against the reflected input shape.',
        commit: 'dbaf296'
      },
      {
        type: 'improvement',
        text: 'cliProxy failures are legible: a 401/403 prints "authentication failed - check your token" instead of an SDK stack trace, and root --help/--version work without a reachable server.',
        commit: 'dbaf296'
      }
    ]
  },
  {
    version: '4.2.0',
    date: '2026-07-17',
    summary: 'Telemetry: every ToolCallEvent now carries the call\'s input (args), and argument-validation failures - previously invisible - emit events too.',
    changes: [
      {
        type: 'feature',
        text: 'ToolCallEvent.args: the per-call input on every transport - the parsed (post-zod) input the action ran with, per-procedure even inside a tRPC httpBatch request. Unredacted by contract: redact/truncate in your hook before persisting.',
        commit: '3e4a88a'
      },
      {
        type: 'feature',
        text: 'Argument-validation failures now emit telemetry (ok: false, stable errorCode INVALID_ARGUMENTS, args = the raw offered input). The MCP SDK rejects an invalid tools/call before the handler runs, so http()/mcpTransport()/edge() pre-validate emit-only (the wire response is unchanged - the SDK still produces its native rejection); the NestJS trpc() adapter emits the same events from tRPC\'s onError seam. A misbehaving agent hammering wrong schemas is now visible in metrics.',
        commit: '3e4a88a'
      }
    ]
  },
  {
    version: '4.1.0',
    date: '2026-07-16',
    summary: '@silkweave/typegen drops its typescript peer dependency - it now emits .d.ts text directly, so nothing links the TypeScript compiler at server boot (works on the native tsgo/TS7 toolchain).',
    changes: [
      {
        type: 'improvement',
        text: '@silkweave/typegen no longer requires (or links) the `typescript` compiler at runtime. It only ever produced .d.ts text and never type-checked, so the compiler-API AST factory + printer were replaced with direct string emission. This removes the `typescript` peer dependency entirely - relevant if you run on the native TypeScript (tsgo / TS7) toolchain, which does not ship the JS compiler API.',
        commit: '6bf4b6a'
      },
      {
        type: 'breaking',
        text: 'The low-level exported helper `zodToTs(schema)` now returns a TypeScript type-expression string instead of a `ts.TypeNode`. The high-level API (the typegen() adapter, renderTypegen/generateDts/generateTrpcRouter) is unchanged, and generated output is semantically identical (reformatted to 2-space, no-semicolon style). Only direct importers of `zodToTs` are affected.',
        commit: '6bf4b6a'
      }
    ]
  },
  {
    version: '4.0.1',
    date: '2026-07-14',
    summary: 'Patch: kebab-case CLI flags now map correctly onto snake_case action input keys in both CLI surfaces.',
    changes: [
      {
        type: 'fix',
        text: 'MCP CLI proxy: flag values for snake_case tool input keys (e.g. --action-id for action_id) were silently dropped - Commander stores parsed options camelized, so the read-back now goes through camelCase(key).',
        commit: '0db2adf'
      },
      {
        type: 'fix',
        text: 'CLI adapter: the same kebab-vs-snake mismatch made snake_case action input keys fail validation; option read-back is now camelCase-aware. @silkweave/cli also gained its first Vitest regression suite.',
        commit: '6174d5a'
      }
    ]
  },
  {
    version: '4.0.0',
    date: '2026-07-13',
    summary: 'Dependency-boundary cleanup from the post-3.2 audit: every package now installs only what it actually uses. Breaking, but the migration is mostly a few import-path and install changes.',
    changes: [
      {
        type: 'breaking',
        text: 'The Express http() server moved off the @silkweave/mcp root to the @silkweave/mcp/server subpath. Update `import { http } from \'@silkweave/mcp\'` to `\'@silkweave/mcp/server\'` (same for mcpTransport, oauthRoutes, protectedResourceMetadata, sideloadResource, mcpCors, authMiddleware). The root now carries only the express-free surface (stdio, registerTools, result helpers, filterActions), so stdio-only and serverless consumers no longer pull express/cors.'
      },
      {
        type: 'breaking',
        text: '@silkweave/core no longer depends on @modelcontextprotocol/sdk (it now has zero runtime dependencies). The action toolResult hook is typed against a new dependency-free core `ToolResult` type instead of the SDK\'s CallToolResult - structurally identical, so most code is unaffected. A CLI/Fastify/tRPC/typegen-only install no longer drags in the entire MCP HTTP server stack.'
      },
      {
        type: 'breaking',
        text: '@silkweave/nextjs now declares @silkweave/trpc (and @trpc/server) as optional peer dependencies and lazy-loads each route builder: an MCP-only app never installs or loads the tRPC stack, and a tRPC-only app never loads @silkweave/edge. If you use app.trpc(), add @silkweave/trpc + @trpc/server to your install.'
      },
      {
        type: 'breaking',
        text: '@silkweave/fastify now declares @scalar/fastify-api-reference (the Swagger/Scalar docs UI) as an optional peer dependency. Headless API deployments no longer pay its install weight; if you want the docs UI, add @scalar/fastify-api-reference to your install (the adapter logs a hint and serves the API without it otherwise).'
      },
      {
        type: 'improvement',
        text: '@silkweave/edge is now genuinely Node-builtin-free: the shared MCP result helpers use web-standard crypto/base64, and per-request auth is threaded through the silkweave context instead of AsyncLocalStorage - so the edge/serverless path no longer imports node:crypto or node:async_hooks.'
      }
    ]
  },
  {
    version: '3.2.1',
    date: '2026-07-13',
    summary: 'Security and correctness patch batch from the post-3.2 deep audit. No API breaks - upgrade recommended for anyone using auth, the edge/HTTP transports, or the tRPC/CLI/Fastify adapters.',
    changes: [
      {
        type: 'fix',
        text: 'tRPC standalone adapter with auth no longer crashes the Node process on an unauthenticated request. The auth failure is now signalled through tRPC (proper 401 + WWW-Authenticate challenge) instead of writing the raw response and racing tRPC into an ERR_STREAM_WRITE_AFTER_END crash. The same fix makes trpcFetch (and @silkweave/nextjs) return 401 with challenge headers instead of a 500 that leaked a stack trace.'
      },
      {
        type: 'fix',
        text: 'OAuth redirect_uri matching is now component-aware: a wildcard can no longer cross host/path boundaries. Closes an open-redirect / authorization-code-theft vector where patterns like https://*.example.com/cb matched attacker hosts and loopback patterns (http://localhost:*) were bypassable via userinfo injection (http://localhost:x@attacker.com).'
      },
      {
        type: 'fix',
        text: 'The /resource/:id sideload route now contains reads to its resource directory (path traversal via encoded ../ is rejected), and the stateless MCP transports (http + edge) reject JSON-RPC batches - which also closes a per-request filterActions bypass where only the first batch message was inspected.'
      },
      {
        type: 'fix',
        text: 'OAuth hardening: the JSON persistence store writes secrets 0600 (owner-only), the CIMD client_id fetch blocks private/loopback/link-local/metadata addresses and disallows redirects (SSRF), and refresh tokens are now rotated on use and bound to the presenting client.'
      },
      {
        type: 'fix',
        text: 'CLI adapter coerces numeric/bigint option values, so z.number() fields are usable on the command line (previously every numeric option failed validation); positional arguments are now bound in action.args order.'
      },
      {
        type: 'feature',
        text: 'edge() gains allowedHosts / allowedOrigins (opt-in DNS-rebinding protection) and corsOrigin (restrict the CORS Access-Control-Allow-Origin from the default *).'
      },
      {
        type: 'improvement',
        text: 'Fastify now runs Zod parse on the merged input (so .refine()/.email()/.transform() are enforced over REST like every other adapter), tears down a streaming action generator on client disconnect (no more leaked generators), and honors auth.callbackPath. Structured MCP actions reject a conflicting toolResult hook or a non-idempotent (.transform()) output schema at boot. Assorted correctness fixes across @silkweave/ai, @silkweave/nextjs, @silkweave/typegen, and the tRPC router type inference.'
      }
    ]
  },
  {
    version: '3.2.0',
    date: '2026-07-13',
    summary: 'MCP tools get first-class quality signals: annotations, typed output contracts, per-request filtering, and a telemetry hook.',
    changes: [
      {
        type: 'breaking',
        text: 'MCP tool results now default to compact JSON (jsonToolResult) instead of smart embedded-resource splitting. Restore the old behavior per action with disposition: \'smart\', per tool with @Mcp({ result: \'smart\' }), or module-wide with defaultResult: \'smart\' in @silkweave/nestjs. A client\'s _meta.disposition still overrides either default.',
        commit: 'a9edf71'
      },
      {
        type: 'feature',
        text: 'Structured output: disposition: \'structured\' declares the action\'s output Zod schema as the tool\'s MCP outputSchema - agents see the result shape in tools/list before calling - and ships the schema-parsed result as structuredContent. Extra fields are stripped before shipping (so returning a wider object is safe against the SDK\'s two-sided validation), and a genuine mismatch degrades to an agent-legible isError result naming the failing fields. In NestJS, @Mcp({ result: \'structured\', output }) requires an explicit schema - reflected @ApiOkResponse schemas are deliberately rejected as hard contracts.',
        commit: 'a9edf71'
      },
      {
        type: 'feature',
        text: 'Tool annotations: every MCP tool now carries ToolAnnotations (readOnlyHint derived from kind, or from the HTTP verb in NestJS - @Get => read-only + idempotent, @Delete => destructive) with explicit overrides via Action.annotations / @Mcp({ annotations }). Clients like Claude Code use these to group and permission-gate tools.',
        commit: 'bd3cb4f'
      },
      {
        type: 'feature',
        text: 'Per-request tool filtering: filterActions on http(), mcpTransport(), edge(), and NestJS mcp() recomputes the tool list per request (per-API-key permissions, tool groups, read-only keys). The callback receives { headers, url, method, toolName } - method is the JSON-RPC method, so initialize/ping can skip lookups - and applies to tools/call too. A thrown SilkweaveError surfaces as its statusCode with a JSON-RPC error body, never an empty tool list. Actions gain free-form tags to filter on.',
        commit: '1c9e5d7'
      },
      {
        type: 'feature',
        text: 'Telemetry: an onToolCall hook on every MCP adapter reports one fire-and-forget event per tool call ({ action, tool, transport, durationMs, ok, errorCode, resultBytes, sideloaded, context }). @silkweave/nestjs wires it through DI - forRoot({ telemetry: MyTelemetryService }) - covering MCP and tRPC calls (guard denials included), exactly one event per call.',
        commit: '3a7f6fe'
      },
      {
        type: 'fix',
        text: 'Workspace tests now resolve cross-package @silkweave/* imports to TS source at runtime (not stale build output), and the shared Vitest config no longer leaks bundler resolution conditions into CJS require() chains.',
        commit: '1c9e5d7'
      }
    ]
  },
  {
    version: '3.1.0',
    date: '2026-07-08',
    summary: 'A leaner dependency graph: the logger folds into core and @clack/prompts is gone entirely.',
    changes: [
      {
        type: 'improvement',
        text: 'The @silkweave/logger package is gone - its structured logger (createLogger, buildLogLevels) and the Logger/LogLevel types now live in @silkweave/core, where they belong (the logger is the shape of the context.get(\'logger\') key every action receives) and add zero dependencies. Import them from @silkweave/core; the silkweave/logger umbrella subpath still works unchanged.',
        commit: 'efa818d'
      },
      {
        type: 'improvement',
        text: '@clack/prompts is dropped repo-wide. A new zero-dependency createConsoleLogger() in @silkweave/core (each log level mapped to console.log/info/warn/error) replaces the old clack-based createCLILogger(); the CLI adapter and MCP cliProxy now emit plain console output. clack was purely cosmetic, so nothing load-bearing changed.',
        commit: 'efa818d'
      },
      {
        type: 'fix',
        text: 'Removed a dead zod@3 dependency the former logger package carried but never imported.',
        commit: 'efa818d'
      }
    ]
  },
  {
    version: '3.0.0',
    date: '2026-06-21',
    summary: 'A stateless, web-standard, agent-first 3.0: sessionless MCP transport, a leaner auth and dependency surface, and the Vercel adapter generalised into a portable edge adapter.',
    changes: [
      {
        type: 'breaking',
        text: 'Renamed @silkweave/vercel to @silkweave/edge, and its adapter vercel() to edge() (types EdgeAdapter/EdgeAdapterOptions; umbrella subpath silkweave/edge). It is platform-agnostic Web-Standard - one adapter for Cloudflare Workers, Vercel, Bun, Deno, Hono, and Next.js. Update imports; there is no back-compat alias.',
        commit: '44f5257'
      },
      {
        type: 'breaking',
        text: 'The MCP HTTP transport is now stateless: no Mcp-Session-Id, no session map, no GET/DELETE reconnect. Each request mints a fresh transport, so servers scale horizontally with zero shared in-memory state.',
        commit: '5c82214'
      },
      {
        type: 'breaking',
        text: '@silkweave/auth is split: the spec-required resource-server core (bearer-token validation + protected-resource metadata, jose-only) stays at the root, while the OAuth 2.1 authorization-server proxy (PKCE, refresh tokens, CIMD, dynamic client registration) plus the persistence stores move behind the opt-in @silkweave/auth/oauth subpath. A pure resource server no longer pulls the issuer machinery into its graph.',
        commit: '5c82214'
      },
      {
        type: 'breaking',
        text: 'express and cors are now optional peerDependencies of @silkweave/mcp (needed only for the Express http() server). The transport-agnostic tool-registration and result helpers are re-exported from the express-free @silkweave/mcp/tools subpath, which the web-standard adapters import - so serverless bundles and installs never pull Express.',
        commit: '832100f'
      },
      {
        type: 'feature',
        text: 'Resource-server hardening for the 2026 OAuth SEPs: audience binding (RFC 8707), issuer binding (RFC 9207), step-up scope challenges (SEP-2350), and scopes_supported in protected-resource metadata (RFC 9728).',
        commit: '4c0d13d'
      },
      {
        type: 'feature',
        text: 'Action linter guardrail: silkweave().start() warns at dev time about agent-hostile action definitions (missing or throwaway descriptions, undescribed input params) - the cheap mistakes that quietly degrade an agent\'s tool use. Disable with SilkweaveOptions.lint: false.',
        commit: 'ad52cc9'
      },
      {
        type: 'feature',
        text: 'New Cloudflare Workers example: stateless MCP + Google Workspace OAuth 2.1 with OAuth state in Cloudflare KV (reusing createRedisStore over a tiny KV adapter, since Workers have no filesystem). Ships with a from-scratch Cloudflare + Google setup guide.',
        commit: '44f5257'
      },
      {
        type: 'fix',
        text: 'The edge adapter answers GET/DELETE on the MCP endpoint with 405 in stateless mode, instead of opening a never-closing SSE stream that hangs the request on serverless runtimes (Cloudflare cancelled it as "hung").',
        commit: '44f5257'
      }
    ]
  },
  {
    version: '2.6.1',
    date: '2026-06-18',
    summary: 'Slimmer dependency tree - pino dropped entirely, and the CLI proxy no longer leaks into the MCP server path.',
    changes: [
      {
        type: 'improvement',
        text: 'Dropped pino entirely. @silkweave/logger\'s createLogger() is now a zero-dependency structured logger (JSON lines to a stream, with a level threshold and onLog/onProgress callbacks) - same API, no behaviour change for the stdio/http/vercel adapters. The package\'s only hard dependency is now zod.',
        commit: '6528d3b'
      },
      {
        type: 'improvement',
        text: '@silkweave/core no longer depends on @silkweave/logger (it never imported it - the logger reaches actions via context.get(\'logger\')). The @Mcp()/@Trpc() decorator import path in @silkweave/nestjs now pulls neither pino nor @clack/prompts on boot.',
        commit: '6528d3b'
      },
      {
        type: 'breaking',
        text: 'The cliProxy adapter moved from the @silkweave/mcp root to the dedicated @silkweave/mcp/cli-proxy subpath, so importing the stdio/http servers no longer bundles the CLI client\'s commander + @clack/prompts. Update imports: import { cliProxy } from \'@silkweave/mcp/cli-proxy\'.',
        commit: '6528d3b'
      },
      {
        type: 'breaking',
        text: 'commander and @clack/prompts are now optional peerDependencies of @silkweave/mcp (used only by the CLI proxy). Install them alongside @silkweave/mcp when you use @silkweave/mcp/cli-proxy; MCP server-only installs no longer pull them. @clack/prompts is likewise an optional peer of @silkweave/logger (needed only for createCLILogger()).',
        commit: '6528d3b'
      }
    ]
  },
  {
    version: '2.6.0',
    date: '2026-06-18',
    summary: 'NestJS reflection gets louder and more precise - and @Res() works over tRPC.',
    changes: [
      {
        type: 'feature',
        text: 'Boot-time warning when a @Mcp/@Trpc whole-DTO @Body()/@Query() param reflects no fields. The usual cause is an intersection/union type (e.g. CreateDto & Extra), which TypeScript erases to Object so every DTO field is silently dropped - a ({ input }) override adds fields but does not recover them. The warning names the controller method and param so the footgun is caught at startup instead of as client-side drift.',
        commit: '4f448e5'
      },
      {
        type: 'feature',
        text: 'Boot-time warning when a reflected @Trpc output field degrades to unknown/unknown[] (a nested DTO or Dto[] - reflection is one level deep). Explicit @Trpc({ output }) schemas are your own typing and are never flagged. Supply @Trpc({ output }) with a Zod schema for a precise nested shape.',
        commit: '4f448e5'
      },
      {
        type: 'feature',
        text: '@Res() now works over the tRPC transport - @Res({ passthrough: true }) resolves to the real Express response, so a handler can set session cookies/headers. Previously it was undefined on both transports. Over MCP it stays undefined (no HTTP response).',
        commit: '4f448e5'
      },
      {
        type: 'improvement',
        text: '@Mcp/@Trpc({ input }) now accept a whole z.object({ ... }) (its .shape is unwrapped) in addition to a raw { field: z.type() } shape, and accept a schema from Zod v3 or v4 - a relief for apps already migrated to zod/v4. Override detection is duck-typed, so it does not depend on a shared Zod instance.',
        commit: '4f448e5'
      },
      {
        type: 'improvement',
        text: 'Reflect nullable fields - @ApiProperty({ nullable: true }) (and OpenAPI nullable) map to a .nullable() Zod field (string | null). class-validator has no null signal, so @IsOptional() stays optional-not-nullable.',
        commit: '4f448e5'
      }
    ]
  },
  {
    version: '2.5.0',
    date: '2026-06-18',
    summary: 'NestJS controllers gain end-to-end-typed tRPC, plus a much lighter install.',
    changes: [
      {
        type: 'feature',
        text: '@Trpc() decorator for @silkweave/nestjs - the tRPC sibling of @Mcp. Expose a controller route as an end-to-end-typed tRPC procedure, reflecting input from the same sources @Mcp uses. Adds precise output types (from @ApiOkResponse({ type }) or @Trpc({ output })), verb-inferred query/mutation kind, and async-generator routes as SSE subscriptions. One method can carry @Mcp + @Trpc + @UseGuards at once.',
        commit: '6b01553'
      },
      {
        type: 'feature',
        text: 'trpc() and typegen() NestJS adapters. trpc() mounts httpBatch (query/mutation) + SSE (subscription) on Nest’s HTTP server; guards read the real Express request (cookie/header auth) and denials surface as a TRPCError carrying data.httpStatus. typegen() writes the AppRouter type for createTRPCClient<AppRouter>() on boot.',
        commit: '6b01553'
      },
      {
        type: 'improvement',
        text: 'Lighter install - NestJS adapters now live behind subpath exports (@silkweave/nestjs/mcp, /trpc, /typegen) with their stacks as optional peer dependencies, so an MCP-only app never pulls in @trpc/server and a tRPC-only app never pulls in the MCP SDK. rxjs is now externalized instead of bundled, shrinking the core build from 360KB to 45KB.',
        commit: '6b01553'
      },
      {
        type: 'breaking',
        text: 'NestJS adapter imports moved to subpaths: import { mcp } from \'@silkweave/nestjs/mcp\' (likewise /trpc, /typegen) instead of from \'@silkweave/nestjs\'. The @Mcp/@Trpc decorators and SilkweaveModule stay on the root. Add the adapter package(s) you use - @silkweave/mcp, @silkweave/trpc, @silkweave/typegen - as dependencies.',
        commit: '6b01553'
      }
    ]
  },
  {
    version: '2.4.0',
    date: '2026-06-16',
    summary: 'A new Next.js App Router adapter joins the family.',
    changes: [
      {
        type: 'feature',
        text: '@silkweave/nextjs - Next.js App Router adapter. defineSilkweave({ actions }) projects one action set onto route handlers: app.mcp() exposes MCP tools for agents and app.trpc() a typed tRPC endpoint for your frontend. Additive, App Router only, no next/react dependency.',
        commit: '1b3dc23'
      },
      {
        type: 'feature',
        text: 'NestJS module-wide default result format - SilkweaveModule.forRoot({ defaultResult }) sets the MCP result format for every tool (a per-method @Mcp({ result }) and a client’s _meta.disposition still override it).'
      }
    ]
  },
  {
    version: '2.3.0',
    date: '2026-06-16',
    changes: [
      {
        type: 'feature',
        text: 'Configurable MCP result format - set @Mcp({ result: \'json\' }) (or an action’s disposition) to return compact JSON instead of the default smart embedded-resource output. Clients can still override per call.',
        commit: '1eeab3e'
      }
    ]
  },
  {
    version: '2.2.0',
    date: '2026-06-16',
    changes: [
      {
        type: 'improvement',
        text: 'NestJS path-scoped guards now work over MCP - request.params is populated from the route’s path bindings before guards run, so an API-key guard that scopes by :id behaves the same over MCP as over REST.',
        commit: 'c98f773'
      }
    ]
  },
  {
    version: '2.1.0',
    date: '2026-06-16',
    changes: [
      {
        type: 'feature',
        text: 'NestJS app-global guards (APP_GUARD / useGlobalGuards) can be opted into MCP tool calls via an explicit allow-list.',
        commit: 'aff769d'
      },
      {
        type: 'fix',
        text: 'MCP tool errors no longer leak stack traces to clients - only a safe message goes on the wire; the full error stays server-side.',
        commit: '34501fe'
      },
      {
        type: 'fix',
        text: 'Published packages resolve to build output, while in-repo development keeps using TypeScript source - no rebuild needed for cross-package edits.',
        commit: '29c4581'
      }
    ]
  },
  {
    version: '2.0.0',
    date: '2026-06-15',
    summary: 'The NestJS adapter is now additive controller reflection - a breaking rework of how Nest routes become MCP tools.',
    changes: [
      {
        type: 'breaking',
        text: 'Expose existing NestJS controllers as MCP tools by adding a single @Mcp() decorator. Tool name, description, and input schema are reflected from the route + @Param/@Query/@Body + Swagger / class-validator metadata - nothing is re-declared.',
        commit: 'c66ff63'
      }
    ]
  },
  {
    version: '1.12.0',
    date: '2026-06-15',
    summary: 'A big release: tRPC, Next.js, the Vercel AI SDK bridge, and REST routing all land.',
    changes: [
      {
        type: 'feature',
        text: 'tRPC adapter - every action becomes an end-to-end type-safe procedure via InferTrpcRouter<typeof server>, with a standalone HTTP server and a fetch handler for serverless runtimes.',
        commit: '04ee310'
      },
      {
        type: 'feature',
        text: 'NestJS integration - expose NestJS controller and provider methods as MCP tools, REST routes, and tRPC procedures via decorators.',
        commit: 'aff4e4b'
      },
      {
        type: 'feature',
        text: '@silkweave/ai - bridge useChat to a streaming action over tRPC subscriptions (silkweaveTransport + createChatAction), with an end-to-end Vite + React example.',
        commit: '6582e93'
      },
      {
        type: 'feature',
        text: 'REST routing - actions gain method / path / queryParams to map a single input schema across the URL path, query string, and body; NestJS Swagger support included.',
        commit: '4a935e3'
      },
      {
        type: 'feature',
        text: 'NestJS async-generator methods stream as tRPC subscriptions.',
        commit: 'bb20176'
      }
    ]
  },
  {
    version: '1.6.0',
    date: '2026-04-14',
    changes: [
      {
        type: 'feature',
        text: 'Configurable CORS on the http() and fastify() adapters.',
        commit: '768b388'
      },
      {
        type: 'improvement',
        text: 'Document the optional output schema on the Action interface (used by typegen and tRPC for typed responses).',
        commit: 'd97fdec'
      }
    ]
  },
  {
    version: '1.5.0',
    date: '2026-04-14',
    changes: [
      {
        type: 'feature',
        text: '@silkweave/typegen adapter - generate .d.ts response interfaces straight from your action Zod schemas using the TypeScript compiler API.',
        commit: 'c558738'
      },
      {
        type: 'improvement',
        text: 'Build pipeline migrated from tsup to tsdown for faster, cleaner ESM output.',
        commit: '6ce85d2'
      }
    ]
  },
  {
    version: '1.4.0',
    date: '2026-04-10',
    summary: 'Initial public release of the Action → Adapter toolkit: MCP stdio/HTTP, CLI, Fastify, Vercel, and auth.',
    changes: [
      {
        type: 'feature',
        text: 'Smart tool results - large MCP responses are automatically split into a short text summary plus a base64 embedded resource, keeping the model’s context window lean.',
        commit: '391085a'
      },
      {
        type: 'feature',
        text: 'Define an Action once and expose it via multiple adapters: MCP (stdio + Streamable HTTP), CLI, Fastify REST with Swagger, and a stateless Vercel serverless adapter - plus OAuth 2.1 / bearer auth.',
        commit: '20c7d74'
      }
    ]
  },
  {
    version: '1.0.0',
    date: '2026-04-08',
    unreleased: true,
    summary: 'The original prototype - a proof of concept for defining an Action once and running it across transports.',
    changes: [
      {
        type: 'feature',
        text: 'First proof of concept: the Action → Adapter → Silkweave pattern, validating that a single typed operation could be exposed over multiple transports.'
      }
    ]
  }
]
