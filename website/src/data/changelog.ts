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
