# @silkweave/nestjs

NestJS adapter for [Silkweave](https://github.com/silkweave/silkweave). Define actions as method decorators on Nest providers, then expose them simultaneously over REST, tRPC, and MCP Streamable HTTP - all mounted on the running Nest HTTP server so Nest middleware, guards, and lifecycle hooks stay coherent.

## Install

```bash
pnpm add @silkweave/core @silkweave/nestjs @nestjs/common @nestjs/core @nestjs/platform-express reflect-metadata
```

> NestJS dev workflows need decorator-aware transforms. Recommend `@swc-node/register` (`node --import @swc-node/register/esm-register src/main.ts`) or the standard `nest start` CLI; plain `tsx` doesn't emit decorator metadata.

## Usage

```ts
// users.actions.ts
import { Injectable, UseGuards } from '@nestjs/common'
import { type SilkweaveContext } from '@silkweave/core'
import { Action, Actions } from '@silkweave/nestjs'
import z from 'zod/v4'
import { AdminGuard } from './admin.guard.js'

const ListInput = z.object({ activeOnly: z.coerce.boolean().optional() })
const GetInput = z.object({ id: z.string() })
const BanInput = z.object({ id: z.string(), reason: z.string() })

@Injectable()
@Actions('users')
export class UserActions {
  constructor(private readonly db: DbService) {}

  @Action({
    description: 'List users',
    input: ListInput,
    kind: 'query'
  })
  list(input: z.infer<typeof ListInput>, _ctx: SilkweaveContext) {
    return this.db.listUsers(input.activeOnly)
  }

  @Action({
    description: 'Get a single user by ID',
    input: GetInput,
    kind: 'query'
  })
  get(input: z.infer<typeof GetInput>) {
    return this.db.getUser(input.id)
  }

  @UseGuards(AdminGuard)            // guard reads the request header on every transport, MCP included
  @Action({
    description: 'Ban a user',
    input: BanInput
  })
  ban(input: z.infer<typeof BanInput>) {
    return this.db.banUser(input.id, input.reason)
  }
}
```

```ts
// app.module.ts
import { Module } from '@nestjs/common'
import { mcp, rest, SilkweaveModule, trpc } from '@silkweave/nestjs'
import { AdminGuard } from './admin.guard.js'
import { UserActions } from './users.actions.js'

@Module({
  imports: [
    SilkweaveModule.forRoot({
      silkweave: { name: 'my-app', description: 'My App', version: '1.0.0' },
      adapters: [
        rest({ basePath: '/api' }),
        trpc({ basePath: '/trpc' }),
        mcp({ basePath: '/mcp' })
      ]
    })
  ],
  providers: [AdminGuard, UserActions]
})
export class AppModule {}
```

```ts
// main.ts
import 'reflect-metadata'
import { NestFactory } from '@nestjs/core'
import { AppModule } from './app.module.js'

const app = await NestFactory.create(AppModule)
await app.listen(8080)
```

The `users.list` and `users.get` actions are now reachable via:

- **REST:** `GET /api/users/list?activeOnly=true` and `GET /api/users/get?id=1`
- **tRPC:** `client.usersList.query({ activeOnly: true })` and `client.usersGet.query({ id: '1' })`
- **MCP:** tools `UsersList` and `UsersGet`

`users.ban` is guarded by `@UseGuards(AdminGuard)` on **every** transport - REST, tRPC, **and** MCP. The guard reads its credential from the request header (`switchToHttp().getRequest().headers`); over MCP the inbound tool-call headers are surfaced the same way (see [Guards & DI](#guards--di)).

## Decorators

### `@Action(options)` (method decorator)

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `name` | `string` | kebab-cased method name | Override the action name. Joined with the class prefix via `.` |
| `description` | `string` | *required* | Human-readable summary. Used as MCP tool description |
| `input` | `z.ZodObject` | *required* | Zod object schema for the action's input |
| `output` | `z.ZodObject` | - | Optional output schema (used by tRPC type inference) |
| `chunk` | `z.ZodType` | - | Schema for chunks yielded by a streaming (`async function*`) method. **Required** when the method is an async generator |
| `kind` | `'query' \| 'mutation'` | `'mutation'` | `'query'` → GET in REST, `.query()` in tRPC. `'mutation'` → POST / `.mutation()` |
| `transports` | `('rest' \| 'trpc' \| 'mcp')[]` | all | Allowlist of transports that expose this action |
| `isEnabled` | `(ctx) => boolean` | - | Dynamic gate (AND-combined with `transports`) |
| `toolResult` | `(response, ctx) => CallToolResult` | - | Custom MCP `CallToolResult` formatter |

### `@Actions(prefix?)` (class decorator)

Groups a class's actions under a common prefix. Joined to method-level names with a dot.

```ts
@Actions('users')
class UserActions {
  @Action({ ... }) list(...) {}    // action name: 'users.list'
  @Action({ name: 'top' }) ... {}  // action name: 'users.top'
}
```

Accepts either a string (shorthand) or `{ prefix, transports }` for a class-wide transport default.

## Adapters

### `rest(options?)`

Maps actions to REST routes on the Nest HTTP server.

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `basePath` | `string` | `'/api'` | URL prefix joined to each action's path |
| `auth` | `AuthConfig` | - | `@silkweave/auth` bearer-token config |

Routes follow `{basePath}/{action-name-with-slashes}` where dots in action names become slashes:

- `users.list` (query) → `GET /api/users/list`
- `users.ban` (mutation) → `POST /api/users/ban`

Each action is registered as an individual route on Nest's HTTP adapter (not a sub-app). Input is parsed from `req.query` (queries) or `req.body` (mutations) and validated against the action's Zod schema; validation failures return HTTP 400 with the Zod issues.

### `trpc(options?)`

Mounts a tRPC HTTP handler built from `@silkweave/trpc`'s `buildRouter`.

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `basePath` | `string` | `'/trpc'` | URL prefix the tRPC handler listens on |
| `auth` | `AuthConfig` | - | `@silkweave/auth` bearer-token config |

Action names with dots (e.g. `users.list`) collapse to camelCase procedure keys (`usersList`) - flat router in v1.

**Streaming.** An `@Action` method declared as an `async function*` (with a `chunk` schema) is registered as a tRPC **subscription** that streams each yielded chunk over SSE - exactly like a standalone `createAction({ chunk, run: async function*(){…} })`. `@UseGuards()` guards still run before the first chunk. This is what `useChat` + `@silkweave/ai`'s `silkweaveTransport()` consume.

```ts
@Action({
  description: 'Stream a countdown',
  input: z.object({ from: z.number().int() }),
  chunk: z.object({ n: z.number().int() })
})
async *countdown(input: { from: number }) {
  for (let n = input.from; n >= 0; n -= 1) {
    await new Promise((r) => setTimeout(r, 200))
    yield { n }
  }
}
```

Declaring an async-generator method without a `chunk` schema throws at discovery time - the schema is required for typegen/tRPC to expose the subscription.

### `mcp(options?)`

Mounts the MCP Streamable HTTP transport directly at `basePath`, with sideload (`{basePath}/resource/:id`), well-known auth metadata (`{basePath}/.well-known/...`), and the OAuth proxy routes (`{basePath}/authorize`, `/token`, `/register`, `/auth/callback`) namespaced under the same prefix. Composes the handler primitives from `@silkweave/mcp` - no Express sub-app.

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `basePath` | `string` | `'/mcp'` | URL prefix; the MCP transport endpoint is at this exact path |
| `auth` | `AuthConfig` | - | Bearer-token / OAuth 2.1 config |
| `cors` | `CorsOptions \| boolean` | `true` | CORS config |
| `sideloadResources` | `boolean` | `true` | Mount `{basePath}/resource/:id` |
| `resourceDir` | `string` | `'resources'` | Directory the sideload route reads from |

## Guards & DI

Native NestJS `@UseGuards()` and `@UseInterceptors()` on `@Action` methods run for **every** transport - REST, tRPC, and MCP. Guards receive an `ExecutionContext` with the request in `switchToHttp().getRequest()`. The `Reflector` is also wired up so guards can read custom metadata.

**Headers over MCP.** REST and tRPC pass the raw HTTP request to the guard. For MCP (Streamable HTTP), the inbound tool-call request is surfaced as a stand-in `{ headers, url, params, query }` object built from the MCP SDK's `extra.requestInfo`, so a header-based guard - e.g. one reading `getRequest().headers['x-api-key']` - works unchanged. `ExecutionContext.getType()` is `'http'` whenever a request is available (and `'rpc'` for transports with none, e.g. MCP stdio). Caveats:

- Only **headers** (and the request `url`) cross the MCP boundary. There are no path `params` or `query` on an MCP tool call, so `getRequest().params` / `.query` are empty objects - guards relying on them degrade to "deny" rather than crash.
- A guard that denies (returns `false` or throws) produces a clean MCP tool error (`ForbiddenException`), not an HTTP 500.
- For OAuth 2.1 / bearer-token MCP auth, prefer `mcp({ auth })` and read the resolved identity from the silkweave context (`ctx.get('auth')`) inside the action; the header stand-in is for custom request-reading guards.

Action methods are normal Nest provider methods - inject services via the constructor as usual.

```ts
@Injectable()
class MyActions {
  constructor(
    private readonly db: DbService,
    private readonly cache: CacheService
  ) {}

  @UseGuards(AuthGuard, RateLimitGuard)
  @Action({ description: '...', input: z.object({...}) })
  async myAction(input, ctx) {
    return this.db.query(...)
  }
}
```

## Action name → transport path

| Action name | REST path | tRPC procedure | MCP tool |
|-------------|-----------|----------------|----------|
| `hello` | `/hello` | `hello` | `Hello` |
| `users.list` | `/users/list` | `usersList` | `UsersList` |
| `posts.get-by-id` | `/posts/get-by-id` | `postsGetById` | `PostsGetById` |

## Notes

- **Lifecycle:** adapters mount their route slots in `OnModuleInit` (before Nest's 404 catch-all is installed) and populate the handlers in `OnApplicationBootstrap` after `@Action` discovery.
- **Express only by default.** `@nestjs/platform-fastify` requires `@fastify/express` registered upfront so Nest can serve Express-style middleware (used by all three adapters internally).
- **Query coercion for REST queries:** request query strings are always strings; use `z.coerce.boolean()` / `z.coerce.number()` in your Zod schemas for queries.
- **`reflect-metadata`** must be imported once at the top of your entry file (typical Nest requirement).

## License

ISC. See [LICENSE](./LICENSE).
