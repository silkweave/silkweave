# @silkweave/trpc

tRPC adapter for [Silkweave](https://github.com/silkweave/silkweave) - expose your actions as fully-typed tRPC procedures with end-to-end TypeScript inference for your client.

## Install

```bash
pnpm add @silkweave/core @silkweave/trpc
```

## Usage

```typescript
// server.ts
import { silkweave } from '@silkweave/core'
import { trpc, type InferTrpcRouter } from '@silkweave/trpc'
import { GreetAction } from './actions/greet.js'
import { ListThingsAction } from './actions/list-things.js'

const server = silkweave({ name: 'my-api', description: 'My tRPC API', version: '1.0.0' })
  .adapter(trpc({ host: 'localhost', port: 8080 }))
  .action(GreetAction)
  .action(ListThingsAction)

export type AppRouter = InferTrpcRouter<typeof server>

await server.start()
```

Client:

```typescript
// client.ts
import { createTRPCClient, httpBatchLink } from '@trpc/client'
import type { AppRouter } from './server.js'

const client = createTRPCClient<AppRouter>({
  links: [httpBatchLink({ url: 'http://localhost:8080/trpc' })]
})

// Fully typed: input and return types are inferred from the action's Zod schemas
const hello = await client.greet.mutate({ name: 'World' })
//    ^? { message: string }

const things = await client.listThings.query({ contains: 'saw' })
//    ^? { items: string[] }
```

## Type Safety

The adapter is paired with the generic `Silkweave<Actions>` builder so that `typeof server` carries the full action map through your `.action()` / `.actions()` calls. `InferTrpcRouter<typeof server>` then produces a `TRPCBuiltRouter` type where:

- Each `Action<I, O, N, K>` becomes a `camelCase(N)` procedure
- `kind: 'query'` dispatches to `.query()` (GET, cacheable); default is `.mutation()` (POST)
- Input type is `z.infer<typeof action.input>`
- Output type is `Awaited<ReturnType<typeof action.run>>` (narrower than the optional `action.output` Zod type when `run` returns a subtype)

There is **no code generation** - the types flow statically through the TypeScript compiler. Just `export type AppRouter = InferTrpcRouter<typeof server>` and import it on the client.

## Queries vs. Mutations

Actions default to `kind: 'mutation'` (tRPC `.mutation()`, HTTP `POST`). Mark side-effect-free read actions with `kind: 'query'` to get GET-cacheable tRPC queries:

```typescript
createAction({
  name: 'list-things',
  description: 'List things, optionally filtered',
  kind: 'query',
  input: z.object({ contains: z.string().optional() }),
  output: z.object({ items: z.array(z.string()) }),
  run: async ({ contains }) => ({ items: [/* ... */] })
})
```

The literal `'query'` is preserved through `createAction` (generic over `K extends 'query' | 'mutation'`), so `InferTrpcRouter` produces the correct `TRPCQueryProcedure` type - calling `.mutate()` on a query (or vice-versa) is a compile-time error.

## Name Conversion

Action names are converted to tRPC procedure keys using `camelCase` from `change-case`:

| `action.name` | Procedure key |
|---------------|---------------|
| `greet` | `client.greet` |
| `list-things` | `client.listThings` |
| `get_user_by_id` | `client.getUserById` |

## Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `host` | `string` | `'0.0.0.0'` | Bind address |
| `port` | `number` | `8080` | Listen port |
| `endpoint` | `string` | `'/trpc/'` | URL prefix stripped before tRPC routing (trailing slash is normalized) |
| `cors` | `CorsOptions \| boolean` | `true` | `false` to disable. `true`/omit for permissive defaults (`origin: '*'`). Or a [cors](https://www.npmjs.com/package/cors) options object. |
| `auth` | `AuthConfig` | `undefined` | `@silkweave/auth` config. Enables bearer-token validation; `authInfo` is threaded into the action context as `context.get('auth')`. |

## Serverless / Fetch runtimes (`trpcFetch`)

`trpc()` binds a Node HTTP server, which isn't compatible with serverless runtimes like Vercel Functions, Cloudflare Workers, or Astro API routes. For those, use `trpcFetch()`. It returns a fetch-compatible `(Request) => Promise<Response>` handler instead of listening on a port.

```typescript
// server.ts
import { silkweave } from '@silkweave/core'
import { trpcFetch, type InferTrpcRouter } from '@silkweave/trpc'
import { GreetAction } from './actions/greet.js'

const { adapter, handler } = trpcFetch({ endpoint: '/api/trpc' })

export const server = silkweave({ name: 'my-api', version: '1.0.0' })
  .adapter(adapter)
  .action(GreetAction)

export type AppRouter = InferTrpcRouter<typeof server>
export { handler }

await server.start()
```

```typescript
// Astro API route: src/pages/api/trpc/[trpc].ts
import type { APIRoute } from 'astro'
import { handler } from '../../../server/silkweave.js'

export const GET: APIRoute = ({ request }) => handler(request)
export const POST: APIRoute = ({ request }) => handler(request)
```

```typescript
// Vercel Edge function: api/trpc/[trpc].ts
import { handler } from '../../lib/silkweave.js'
export { handler as GET, handler as POST }
```

```typescript
// Cloudflare Worker
import { handler } from './silkweave.js'
export default { fetch: handler }
```

### `trpcFetch` options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `endpoint` | `string` | `'/trpc'` | URL prefix stripped before tRPC routing |
| `auth` | `AuthConfig` | `undefined` | Same semantics as `trpc()`. On auth failure the handler returns a `401 Response` with `WWW-Authenticate` headers |

### Return shape

```ts
{
  adapter: AdapterGenerator                         // pass to .adapter()
  handler: (request: Request) => Promise<Response>  // primary dispatch
  GET: (request: Request) => Promise<Response>      // alias for Astro-style method exports
  POST: (request: Request) => Promise<Response>     // alias for Astro-style method exports
}
```

### Notes

- **CORS**: not handled by `trpcFetch`. Configure it in your host framework (Astro middleware, `vercel.json` headers, Cloudflare Worker response headers, etc).
- **Cold-start safety**: an internal `_ready` promise gates the handler until `server.start()` has completed the router build, so the first invocation from a cold serverless function won't race the module-top `await server.start()`.
- **`server.start()` is still required**. It's what builds the tRPC router from your registered actions. It just doesn't `listen()` in fetch mode.

## Errors

Thrown `SilkweaveError` instances are mapped to `TRPCError` by status code:

| `SilkweaveError.statusCode` | `TRPCError.code` |
|-----------------------------|------------------|
| `400` | `BAD_REQUEST` |
| `401` | `UNAUTHORIZED` |
| `403` | `FORBIDDEN` |
| `404` | `NOT_FOUND` |
| `409` | `CONFLICT` |
| `429` | `TOO_MANY_REQUESTS` |
| `500` (default) | `INTERNAL_SERVER_ERROR` |

Zod validation errors from the input schema are automatically returned as `BAD_REQUEST`. Any other thrown value falls through to `INTERNAL_SERVER_ERROR`.

## See Also

- [Silkweave README](https://github.com/silkweave/silkweave) - Full documentation
- [`@silkweave/core`](https://www.npmjs.com/package/@silkweave/core) - Core library
- [tRPC documentation](https://trpc.io/) - Client setup, React Query integration, subscriptions, and more
