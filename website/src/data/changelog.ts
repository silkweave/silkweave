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
