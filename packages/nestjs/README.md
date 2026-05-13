# @silkweave/nestjs

NestJS adapter for [Silkweave](https://github.com/silkweave/silkweave). Define actions as method decorators on Nest providers, then expose them simultaneously over REST, tRPC, and MCP Streamable HTTP — all mounted on the running Nest HTTP server so Nest middleware, guards, and lifecycle hooks stay coherent.

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

  @UseGuards(AdminGuard)
  @Action({
    description: 'Ban a user',
    input: BanInput,
    transports: ['rest', 'trpc']   // exclude from MCP tools
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
        mcp({ basePath: '/' })
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

`users.ban` skips MCP per its `transports: ['rest', 'trpc']` and is guarded by `@UseGuards(AdminGuard)` on every transport that has an HTTP request.

## Decorators

### `@Action(options)` (method decorator)

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `name` | `string` | kebab-cased method name | Override the action name. Joined with the class prefix via `.` |
| `description` | `string` | *required* | Human-readable summary. Used as MCP tool description |
| `input` | `z.ZodObject` | *required* | Zod object schema for the action's input |
| `output` | `z.ZodObject` | — | Optional output schema (used by tRPC type inference) |
| `kind` | `'query' \| 'mutation'` | `'mutation'` | `'query'` → GET in REST, `.query()` in tRPC. `'mutation'` → POST / `.mutation()` |
| `transports` | `('rest' \| 'trpc' \| 'mcp')[]` | all | Allowlist of transports that expose this action |
| `isEnabled` | `(ctx) => boolean` | — | Dynamic gate (AND-combined with `transports`) |
| `toolResult` | `(response, ctx) => CallToolResult` | — | Custom MCP `CallToolResult` formatter |

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
| `basePath` | `string` | `'/'` | URL prefix joined to each action's path |
| `auth` | `AuthConfig` | — | `@silkweave/auth` bearer-token config |

Routes follow `{basePath}/{action-name-with-slashes}` where dots in action names become slashes:

- `users.list` (query) → `GET /api/users/list`
- `users.ban` (mutation) → `POST /api/users/ban`

Input is parsed from `req.query` (queries) or `req.body` (mutations) and validated against the action's Zod schema; validation failures return HTTP 400 with the Zod issues.

### `trpc(options?)`

Mounts a tRPC HTTP handler built from `@silkweave/trpc`'s `buildRouter`.

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `basePath` | `string` | `'/trpc'` | URL prefix the tRPC handler listens on |
| `auth` | `AuthConfig` | — | `@silkweave/auth` bearer-token config |

Action names with dots (e.g. `users.list`) collapse to camelCase procedure keys (`usersList`) — flat router in v1.

### `mcp(options?)`

Mounts MCP Streamable HTTP at `{basePath}/mcp`, plus optional OAuth routes when `auth.provider` is set. Reuses `@silkweave/mcp`'s `createMcpExpressHandler`.

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `basePath` | `string` | `'/'` | Mount point for the MCP sub-app |
| `auth` | `AuthConfig` | — | Bearer-token / OAuth 2.1 config |
| `cors` | `CorsOptions \| boolean` | `true` | CORS config (see `@silkweave/mcp`) |

## Guards & DI

Native NestJS `@UseGuards()` and `@UseInterceptors()` on `@Action` methods run for every HTTP-backed transport. Guards receive an `ExecutionContext` with the HTTP request in `switchToHttp().getRequest()`. The `Reflector` is also wired up so guards can read custom metadata.

Action methods are normal Nest provider methods — inject services via the constructor as usual.

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
