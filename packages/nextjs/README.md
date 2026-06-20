# @silkweave/nextjs

Next.js **App Router** adapter for Silkweave. Define a set of Actions once and
project them onto Next.js route handlers - **MCP tools** for agents and a
**tRPC endpoint** for your own frontend - from a single source of truth.

This package is action-first and additive: it adds route files to an existing
Next.js app, it doesn't restructure anything. Under the hood it wraps
[`@silkweave/edge`](../edge) (MCP over Web-Standard Streamable HTTP) and
[`@silkweave/trpc`](../trpc) (fetch handler), adding the Next.js glue -
catch-all path normalization, ergonomic route factories, and end-to-end tRPC
types.

## Install

```bash
pnpm add @silkweave/nextjs @silkweave/core
# for the typed tRPC client on the frontend:
pnpm add @trpc/client
```

Requires Next.js 13.4+ (App Router). The package itself has no `next`/`react`
dependency - it only deals with Web-Standard `Request`/`Response`.

## Usage

### 1. Define your actions and the app (single source of truth)

```ts
// silkweave/actions.ts
import { createAction } from '@silkweave/core'
import { z } from 'zod'

export const listUsers = createAction({
  name: 'list-users',
  kind: 'query',
  description: 'List users',
  input: z.object({ activeOnly: z.boolean().optional() }),
  run: async ({ activeOnly }) => ({ users: activeOnly ? [] : [{ id: '1' }] })
})

export const banUser = createAction({
  name: 'ban-user',
  description: 'Ban a user',
  input: z.object({ id: z.string(), reason: z.string().min(3) }),
  run: async ({ id, reason }) => ({ banned: id, reason })
})
```

```ts
// silkweave/server.ts
import { defineSilkweave } from '@silkweave/nextjs'
import { banUser, listUsers } from './actions'

export const app = defineSilkweave({
  name: 'my-app',
  description: 'My app exposed to agents + frontend',
  version: '1.0.0',
  actions: [listUsers, banUser]
})

// Type-only export for the tRPC client:
export type AppRouter = typeof app.Router
```

### 2. Mount the MCP route (one catch-all file)

```ts
// app/api/mcp/[[...mcp]]/route.ts
import { app } from '@/silkweave/server'

export const { GET, POST, DELETE, OPTIONS } = app.mcp({ basePath: '/api/mcp' })

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
```

The single `[[...mcp]]` catch-all file serves the MCP transport (`/api/mcp`)
plus any OAuth and protected-resource-metadata sub-paths
(`/api/mcp/.well-known/...`, `/api/mcp/authorize`, ...). `basePath` is stripped
from incoming requests so the underlying MCP handler - which matches absolute
paths - resolves correctly regardless of where you mount it.

### 3. Mount the tRPC route

```ts
// app/api/trpc/[trpc]/route.ts
import { app } from '@/silkweave/server'

export const { GET, POST, OPTIONS } = app.trpc({ endpoint: '/api/trpc' })

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
```

### 4. Call it from your frontend with full type safety

```ts
// lib/trpc.ts
import { createTRPCClient, httpBatchLink } from '@trpc/client'
import type { AppRouter } from '@/silkweave/server'

export const trpc = createTRPCClient<AppRouter>({
  links: [httpBatchLink({ url: '/api/trpc' })]
})

// const { users } = await trpc.listUsers.query({ activeOnly: true })
```

## API

### `defineSilkweave(options)`

| Option | Type | Description |
|--------|------|-------------|
| `name` / `description` / `version` | `string` | Server identity (`SilkweaveOptions`). |
| `actions` | `Action[]` | The action set projected onto every surface. |

Returns a `SilkweaveApp` with `.mcp()`, `.trpc()`, and a type-only `Router`
phantom for client inference (`typeof app.Router`).

### `app.mcp(options)` → `{ GET, POST, DELETE, OPTIONS }`

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `basePath` | `string` | - (required) | URL prefix; **must equal the route file's directory** (e.g. `/api/mcp`). |
| `auth` | `AuthConfig` | - | Bearer-token / OAuth 2.1 config (see `@silkweave/auth`). |
| `enableJsonResponse` | `boolean` | `false` | Return a single JSON response instead of an SSE stream when possible. |

### `app.trpc(options)` → `{ GET, POST, OPTIONS }`

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `endpoint` | `string` | - (required) | tRPC prefix; **must equal the route file's directory minus `[trpc]`** (e.g. `/api/trpc`). |
| `auth` | `AuthConfig` | - | Bearer-token / OAuth 2.1 config. |
| `cors` | `boolean` | `false` | Add permissive CORS + an `OPTIONS` handler. Enable only for cross-origin clients - a same-origin Next.js frontend needs none. |

Lower-level building blocks are also exported (`buildMcpRoute`,
`buildTrpcRoute`, `normalizeBasePath`, `rewriteRequestPath`) for custom wiring.

## Notes & gotchas

- **`basePath` must match the file location.** There's no reliable way to read
  the mounted URL at module load, so you pass it explicitly and it must equal
  the route directory (`/api/mcp` ⇄ `app/api/mcp/[[...mcp]]/route.ts`).
- **Runtime.** Use `runtime = 'nodejs'` (the MCP transport needs Node APIs) and
  `dynamic = 'force-dynamic'` (these handlers are never statically cached).
- **RFC 9728 well-known location.** Mounting under `/api/mcp` serves the
  protected-resource metadata under that prefix. MCP discovery is driven by the
  URLs you advertise in `auth`, so self-consistent mounting works. For strict
  spec compliance you can additionally serve
  `/.well-known/oauth-protected-resource` from a root route file.
- **Streaming actions over tRPC** register as subscriptions; consuming them
  needs an SSE/WS tRPC link, not `httpBatchLink`. MCP streams via progress
  notifications as usual.
- **One source, many surfaces.** `.mcp()` and `.trpc()` each build their own
  internal Silkweave instance, so mounting both from the same `app` is safe.

## License

ISC
