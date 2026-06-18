# @silkweave/nestjs

NestJS adapter for [Silkweave](https://github.com/silkweave/silkweave). Expose your **existing NestJS controllers** as MCP (Model Context Protocol) tools by adding a single `@Mcp()` decorator to a route handler - or as **end-to-end-typed tRPC procedures** with the sibling `@Trpc()` decorator. The name, description, and input schema are **reflected** from the route, the `@Param`/`@Query`/`@Body` decorators, and any `@nestjs/swagger` / `class-validator` metadata the method already carries - nothing is re-declared. On a call the validated input is split back into the method's positional arguments and the handler is invoked directly, with `@UseGuards()` guards applied first.

It is **additive**: controllers keep serving HTTP exactly as before, and removing the decorator fully reverts a method. The same method can carry both `@Mcp()` (for agents) and `@Trpc()` (for your frontend) alongside `@UseGuards()`.

## Install

```bash
pnpm add @silkweave/core @silkweave/nestjs @nestjs/common @nestjs/core @nestjs/platform-express reflect-metadata

# then add only the adapter packages you use (each is an optional peer):
pnpm add @silkweave/mcp        # if you use mcp()
pnpm add @silkweave/trpc       # if you use trpc()
pnpm add @silkweave/typegen    # if you use typegen()
```

The adapters live behind **subpath exports** and their stacks are **optional peer dependencies**, so an MCP-only app never pulls in `@trpc/server`, and a tRPC-only app never pulls in the MCP SDK / OAuth stack. The decorators and module come from the root; each adapter from its subpath:

```ts
import { Mcp, Trpc, SilkweaveModule } from '@silkweave/nestjs'
import { mcp } from '@silkweave/nestjs/mcp'
import { trpc } from '@silkweave/nestjs/trpc'
import { typegen } from '@silkweave/nestjs/typegen'
```

`@nestjs/swagger` and `class-validator` are **optional** peers too - install whichever your DTOs already use; the reflector reads both and falls back to TypeScript `design:type` when neither is present.

> NestJS needs decorator-aware transforms with `emitDecoratorMetadata`. Use `@swc-node/register` (`node --import @swc-node/register/esm-register src/main.ts`) or the `nest start` CLI; plain `tsx` does not emit decorator metadata.

## Usage

```ts
// users.controller.ts
import { Body, Controller, Get, NotFoundException, Param, Post, Query, UseGuards } from '@nestjs/common'
import { ApiOperation, ApiParam, ApiProperty, ApiQuery } from '@nestjs/swagger'
import { Mcp } from '@silkweave/nestjs'
import { IsBoolean, IsOptional, IsString, MinLength } from 'class-validator'
import { AdminGuard } from './admin.guard.js'

class BanUserDto {
  @ApiProperty({ description: 'Reason for the ban' })
  @IsString() @MinLength(3)
  reason!: string

  @ApiProperty({ description: 'Whether the ban is permanent', required: false })
  @IsOptional() @IsBoolean()
  permanent?: boolean
}

@Controller('users')
export class UsersController {
  constructor(private readonly db: DbService) {}

  @Get()
  @ApiOperation({ summary: 'List users' })
  @ApiQuery({ name: 'activeOnly', required: false, type: Boolean, description: 'Only active users' })
  @Mcp()
  list(@Query('activeOnly') activeOnly?: boolean) {
    return this.db.listUsers(activeOnly)
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a single user by ID' })
  @ApiParam({ name: 'id', description: 'User ID' })
  @Mcp()
  get(@Param('id') id: string) {
    const user = this.db.getUser(id)
    if (!user) { throw new NotFoundException('user not found') }
    return user
  }

  @Post(':id/ban')
  @ApiOperation({ summary: 'Ban a user' })
  @ApiParam({ name: 'id', description: 'User ID' })
  @UseGuards(AdminGuard)                 // runs on every transport, MCP included
  @Mcp({ description: 'Ban a user (admin only).' })
  ban(@Param('id') id: string, @Body() body: BanUserDto) {
    return this.db.banUser(id, body.reason, body.permanent ?? false)
  }
}
```

```ts
// app.module.ts
import { Module } from '@nestjs/common'
import { SilkweaveModule } from '@silkweave/nestjs'
import { mcp } from '@silkweave/nestjs/mcp'
import { AdminGuard } from './admin.guard.js'
import { UsersController } from './users.controller.js'

@Module({
  imports: [
    SilkweaveModule.forRoot({
      silkweave: { name: 'my-app', description: 'My App', version: '1.0.0' },
      adapters: [mcp({ basePath: '/mcp' })]
    })
  ],
  controllers: [UsersController],
  providers: [AdminGuard]
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

The MCP endpoint at `/mcp` now exposes three tools - `UsersList`, `UsersGet`, `UsersBan` - whose input schemas are reflected from the controllers:

- `UsersGet` → `{ id: string }` (`id` required, described "User ID" from `@ApiParam`)
- `UsersList` → `{ activeOnly?: boolean }` (optional, typed/described from `@ApiQuery`)
- `UsersBan` → `{ id: string, reason: string (minLength 3), permanent?: boolean }` (flattened from the path param + `BanUserDto`, with `@ApiProperty` + `class-validator` merged)

`UsersBan` is guarded by `@UseGuards(AdminGuard)`; over MCP the guard reads the inbound tool-call headers (see [Guards & DI](#guards--di)).

## Decorator

### `@Mcp(options?)` (method decorator)

Exposes the decorated controller route as an MCP tool. Every option is optional.

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `name` | `string` | `${ControllerBase}${MethodName}` (e.g. `UsersGet`) | MCP tool name override |
| `description` | `string` | `@ApiOperation` summary/description, else generated | Tool description |
| `input` | `Record<string, z.ZodType>` | - | Zod raw-shape override merged over the reflected fields (per-field). The escape hatch for shapes reflection can't express - discriminated unions, custom validators, `@Transform` |
| `pipes` | `'apply' \| 'skip'` | `'apply'` | Whether to run parameter-bound pipes (`@Param('id', ParseIntPipe)`) when re-binding |
| `result` | `'json' \| 'smart'` | `'smart'` | Default MCP result format - `'json'` returns compact JSON text (`jsonToolResult`); `'smart'` inlines small payloads and offloads large ones to an embedded resource (`smartToolResult`). A client that sends `_meta.disposition` on the call overrides it |

### Result format

`@Mcp({ result })` sets the format for one tool. To set a default for **every** tool, pass `defaultResult` to the module:

```ts
SilkweaveModule.forRoot({
  silkweave: { name: 'my-api', version: '1.0.0' },
  adapters: [mcp()],
  defaultResult: 'json'   // module-wide default; a per-method @Mcp({ result }) still wins
})
```

Precedence (highest first): a client's per-call `_meta.disposition` → `@Mcp({ result })` → module `defaultResult` → `'smart'`.

## How reflection works

For each `@Mcp` method the adapter builds **one flat Zod input object** by merging, per field, in increasing precedence:

1. TypeScript `design:type` (the parameter/property constructor)
2. `class-validator` decorators (`@IsString`, `@MinLength`, `@IsOptional`, `@IsEnum`, ...) - **optional** peer
3. `@nestjs/swagger` decorators - `@ApiParam`/`@ApiQuery` for scalar path/query params, `@ApiProperty` for whole-DTO properties - **optional** peer
4. An ingested OpenAPI document, matched by HTTP verb + path (`SilkweaveModule.forRoot({ openapi })`)
5. `@Mcp({ input })` raw-shape override

Field sources are derived from the parameter decorators:

| Controller parameter | Tool input |
|----------------------|-----------|
| `@Param('id') id` | scalar field `id` |
| `@Param() params` | one field per `:param` in the route |
| `@Query('limit') limit` | scalar field `limit` |
| `@Query() dto: ListDto` | each property of `ListDto`, flattened to top level |
| `@Body('x') x` | scalar field `x` |
| `@Body() dto: CreateDto` | each property of `CreateDto`, flattened to top level |
| `@Req`/`@Res`/`@Headers`/`@Ip`/`@Session`/files | not exposed; bound at call time (headers/req from the MCP request stand-in, the rest `undefined`) |

On a tool call the validated input is split back into the handler's positional arguments per the same parameter map, parameter-bound pipes run (unless `pipes: 'skip'`), and the method is invoked directly.

### Optional OpenAPI ingestion

Pass a pre-built OpenAPI document (e.g. a committed `openapi.json`, or one built in a two-phase bootstrap) to use it as the authoritative schema source. It is matched to each `@Mcp` method by verb + path and overrides decorator reflection for the fields it covers; unmatched operations/fields fall back to reflection.

```ts
SilkweaveModule.forRoot({
  silkweave: { name: 'my-app', description: 'My App', version: '1.0.0' },
  adapters: [mcp()],
  openapi: openApiDocument
})
```

## Adapter

### `mcp(options?)`

Mounts the MCP Streamable HTTP transport directly at `basePath`, with sideload (`{basePath}/resource/:id`), well-known auth metadata (`{basePath}/.well-known/...`), and the OAuth proxy routes (`{basePath}/authorize`, `/token`, `/register`, `/auth/callback`) namespaced under the same prefix. Composes the handler primitives from `@silkweave/mcp` - no Express sub-app.

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `basePath` | `string` | `'/mcp'` | URL prefix; the MCP transport endpoint is at this exact path |
| `auth` | `AuthConfig` | - | Bearer-token / OAuth 2.1 config |
| `cors` | `CorsOptions \| boolean` | `true` | CORS config |
| `sideloadResources` | `boolean` | `true` | Mount `{basePath}/resource/:id` |
| `resourceDir` | `string` | `'resources'` | Directory the sideload route reads from |

## tRPC

`@Trpc()` is the tRPC sibling of `@Mcp()`. It exposes a controller route as a tRPC procedure, reflecting its key, input, and kind from exactly the same sources `@Mcp` uses - so a single method can serve REST, MCP, and tRPC at once. Two things differ because tRPC consumers need them: **precise output types** in the generated router, and **subscriptions** for `async *` routes.

```ts
import { Mcp, Trpc } from '@silkweave/nestjs'
import { ApiOkResponse, ApiOperation } from '@nestjs/swagger'

class ListUsersResponse {
  @ApiProperty({ type: [UserDto] }) users!: UserDto[]
}

@Controller('users')
export class UsersController {
  @Get('list-by-space')
  @ApiOperation({ summary: 'List the users in a space' })
  @ApiOkResponse({ type: ListUsersResponse })   // ← drives the generated output type
  @UseGuards(AuthGuard)                          // ← reads the real Express request (cookies/headers)
  @Trpc()                                        // → query  `usersListBySpace`
  @Mcp()                                         // → MCP tool `UsersListBySpace`
  listBySpace(@Query() q: ListBySpaceQuery, @Req() req: AppRequest) {
    return this.users.listForSpace(req.user, q.spaceId)
  }
}
```

### `@Trpc(options?)` (method decorator)

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `name` | `string` | `${ControllerBase}.${MethodName}` | Procedure-name override (before camelCasing) |
| `description` | `string` | `@ApiOperation` summary/description, else generated | Procedure description |
| `input` | `Record<string, z.ZodType>` | - | Zod raw-shape override merged over reflected fields (same as `@Mcp({ input })`) |
| `output` | `z.ZodType \| DtoClass \| Record<string, z.ZodType>` | reflected from `@ApiOkResponse` | Explicit output schema driving the generated output type (wins over reflection) |
| `chunk` | `z.ZodType \| DtoClass` | `unknown` | Element type for a subscription's `async *` stream |
| `kind` | `'query' \| 'mutation' \| 'subscription'` | inferred | `@Get` ⇒ query, others ⇒ mutation, `async *` ⇒ subscription |
| `pipes` | `'apply' \| 'skip'` | `'apply'` | Whether to run parameter-bound pipes when re-binding |

### Naming & kind

Procedure keys are `camelCase(`${ControllerBase}.${MethodName}`)` - `UsersController.listBySpace` → `usersListBySpace` - matching the dotted-name → camelCase convention of the core tRPC adapter. Pin any exception with `@Trpc({ name })`. `kind` is inferred from the HTTP verb (`@Get` ⇒ `query`, otherwise `mutation`) or the method body (`async *` ⇒ `subscription`); override with `@Trpc({ kind })`.

### Output types (the precise part)

tRPC carries output types end-to-end, so the generated `AppRouter` needs them. In preference order:

1. **`@ApiOkResponse({ type: Dto })`** (or any 2xx `@ApiResponse`) - the response DTO is flattened like an input DTO into the procedure's output type.
2. **`@Trpc({ output })`** - an explicit Zod schema, DTO class, or raw shape. Wins over reflection. Use it when the return shape can't be reflected losslessly (e.g. **nested** DTOs and `Dto[]` arrays degrade to `unknown`/`unknown[]` - reflection is one level deep). For a precise nested shape, hand `@Trpc({ output })` a Zod schema.

### Subscriptions (`async *` ⇒ SSE)

An `async *` method is registered as a tRPC **subscription** served over SSE. It needs no HTTP verb - a verb-less `@Trpc({ kind: 'subscription', chunk })` exposes it over tRPC **without** creating a public REST route (see [tRPC/MCP without REST](#trpcmcp-without-a-public-rest-route)). Guards run before the first chunk.

```ts
@Trpc({ kind: 'subscription', chunk: BoardTick })   // → subscription `usersWatch`
async *watch(@Query() q: WatchQuery, @Req() req: AppRequest): AsyncGenerator<BoardTick> {
  for await (const tick of this.board.stream(req.user, q)) { yield tick }
}
```

### `trpc(options?)` adapter

Mounts a single tRPC HTTP handler (httpBatch for queries/mutations, SSE for subscriptions) on Nest's HTTP adapter at `basePath`, built from every `@Trpc` route.

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `basePath` | `string` | `'/trpc'` | URL prefix the handler mounts on |
| `cors` | `CorsOptions \| boolean` | `true` | CORS. For cookie auth pass `{ origin: '<spa-origin>', credentials: true }` |
| `auth` | `AuthConfig` | - | Optional transport-edge bearer validation. Usually omitted - `@Trpc` routes authenticate via their own `@UseGuards()` |

**Guards + cookie auth, no separate config.** Each procedure runs the method's `@UseGuards()` first, with the guard receiving a real `ExecutionContext` whose `switchToHttp().getRequest()` is the **actual Express request** (cookies, headers, `req.user`). So an `AuthGuard` reading an HttpOnly session cookie works with no auth config - the client just sends `credentials: 'include'` / `withCredentials`. A denying guard surfaces to the client as a `TRPCError` whose `data.httpStatus` is the guard's HTTP status (e.g. `401`/`403`), so a `splitLink`/`errorLink` can react.

Reach the authenticated principal + silkweave context from a handler with `@Req() req` (read `req.user`, set by the guard - works identically over REST, tRPC, and MCP).

### `typegen(options?)` adapter

On bootstrap, writes a `.ts` file containing the tRPC `AppRouter` type covering every `@Trpc` procedure - the exact `TRPCBuiltRouter` contract `createTRPCClient<AppRouter>()` and `inferRouterInputs`/`inferRouterOutputs` consume. It only sees `@Trpc` actions (MCP tools are gated out), so the emitted router matches what `trpc()` serves.

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `path` | `string` | - | Output file path (resolved against `process.cwd()`; parent dirs created) |
| `format` | `'trpc-router' \| 'interfaces' \| 'all'` | `'trpc-router'` | `'trpc-router'` emits `AppRouter`; `'interfaces'` emits `{Name}Input`/`{Name}Output`; `'all'` both |

```ts
// app.module.ts
import { SilkweaveModule } from '@silkweave/nestjs'
import { mcp } from '@silkweave/nestjs/mcp'
import { trpc } from '@silkweave/nestjs/trpc'
import { typegen } from '@silkweave/nestjs/typegen'

SilkweaveModule.forRoot({
  silkweave: { name: 'my-app', description: 'My App', version: '1.0.0' },
  adapters: [
    mcp({ basePath: '/mcp', auth: mcpAuth }),         // @Mcp methods → MCP tools (bearer/OAuth)
    trpc({ basePath: '/trpc' }),                      // @Trpc methods → tRPC procedures (cookie/guard auth)
    typegen({ path: '../app/src/types/appRouter.ts' })// @Trpc procedures → AppRouter type
  ]
})
```

```ts
// client - the emitted AppRouter is the only import you need
import { createTRPCClient, httpBatchLink, httpSubscriptionLink, splitLink } from '@trpc/client'
import type { AppRouter } from './types/appRouter.js'

export const trpc = createTRPCClient<AppRouter>({
  links: [splitLink({
    condition: (op) => op.type === 'subscription',
    true: httpSubscriptionLink({ url: '/trpc' }),               // SSE, withCredentials for cookies
    false: httpBatchLink({ url: '/trpc', fetch: (u, o) => fetch(u, { ...o, credentials: 'include' }) })
  })]
})
```

### tRPC/MCP without a public REST route

A `@Get`/`@Post` is inherently a public REST route. To expose a method over **tRPC and/or MCP only**, omit the HTTP-verb decorator: Nest never maps it as REST, and `@Trpc({ kind })` (or `@Mcp()`) still picks it up. This is how subscriptions (which are verb-less `async *` methods) and any internal-only procedure stay off the public REST surface.

## Guards & DI

Native NestJS `@UseGuards()` on `@Mcp`/`@Trpc` methods run before the handler is invoked. Guards receive an `ExecutionContext` with the request in `switchToHttp().getRequest()`, and the `Reflector` is wired up so guards can read custom metadata.

**Headers over MCP.** The inbound tool-call request is surfaced as a stand-in `{ headers, url, params, query }` object built from the MCP SDK's `extra.requestInfo`, so a header-based guard - e.g. one reading `getRequest().headers['x-api-key']` - works unchanged. `ExecutionContext.getType()` is `'http'` whenever a request is available (and `'rpc'` for transports with none, e.g. MCP stdio). Caveats:

- **Headers**, the request `url`, and **URL path params** cross the MCP boundary. `getRequest().params` is populated from the route's reflected `@Param` fields (as raw strings, like Express), so a path-scoped guard - e.g. one reading `getRequest().params['id']` to fence a key to one resource - works the same over MCP as over REST. `getRequest().query` is still empty (no query string over MCP).
- A guard that denies (returns `false` or throws) produces a clean MCP tool error (`ForbiddenException`), not an HTTP 500.
- For OAuth 2.1 / bearer-token MCP auth, prefer `mcp({ auth })` and read the resolved identity from the silkweave context (`ctx.get('auth')`); the header stand-in is for custom request-reading guards.

**Global guards (opt-in).** App-global guards - registered via `app.useGlobalGuards(new X())` or `{ provide: APP_GUARD, useClass }` - do **not** run on tool calls by default. Opt them in by class with `globalGuards`:

```ts
SilkweaveModule.forRoot({
  silkweave: { name: 'app', description: 'My App', version: '1.0.0' },
  adapters: [mcp({ basePath: '/mcp' })],
  globalGuards: [ApiKeyGuard]   // runs before each method/class @UseGuards; throttler etc. deliberately excluded
})
```

The allow-list is explicit-by-class on purpose - a blanket "run every global" would also fire unrelated globals (e.g. a `ThrottlerGuard`, which assumes a writable response MCP doesn't provide). Listed guards run **before** the method/class `@UseGuards`, mirroring Nest's request pipeline. They see the same request stand-in as method guards: headers, `url`, and path `params` (populated from reflected `@Param` fields); only `query`/IP-derived logic won't apply over MCP.

Controllers are normal Nest providers - inject services via the constructor as usual.

## What does *not* run

Because the handler is invoked directly (not through Nest's HTTP request pipeline), the following do **not** apply on a tool call - only `@UseGuards()` (plus any opted-in `globalGuards`) and parameter-bound pipes do:

- Globally-registered `ValidationPipe` / interceptors / exception filters (MCP input is instead validated against the reflected Zod schema).
- DTO class instantiation - whole-DTO `@Body()`/`@Query()` arguments arrive as plain objects, so `@Transform` and DTO methods do not fire.
- Discriminated-union / `@ValidateIf` XOR constraints can't be expressed as hard MCP schema constraints - document them in the tool `description` or supply `@Mcp({ input })`.

## Notes

- **Opt-in.** Only methods carrying `@Mcp()`/`@Trpc()` are exposed - controllers are never auto-published.
- **Express only by default.** `@nestjs/platform-fastify` requires `@fastify/express` registered upfront.
- **`reflect-metadata`** must be imported once at the top of your entry file.

## License

ISC. See [LICENSE](./LICENSE).
