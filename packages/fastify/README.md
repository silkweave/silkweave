# @silkweave/fastify

Fastify REST adapter for [Silkweave](https://github.com/silkweave/silkweave) - expose your actions as a REST API with auto-generated OpenAPI/Swagger documentation.

## Install

```bash
pnpm add @silkweave/core @silkweave/fastify
```

## Usage

```typescript
import { silkweave } from '@silkweave/core'
import { fastify } from '@silkweave/fastify'
import { SearchAction } from './actions/search.js'

await silkweave({ name: 'my-api', description: 'My REST API', version: '1.0.0' })
  .adapter(fastify({ host: 'localhost', port: 8080, logger: true }))
  .action(SearchAction)
  .start()
```

Visit `http://localhost:8080/` for the interactive Scalar API reference.

## Route Mapping

By default each action becomes a `POST /{action.name}` route. Zod schemas are converted to JSON Schema for request body validation and OpenAPI documentation.

| Action | Route | Body |
|--------|-------|------|
| `name: 'search'` | `POST /search` | `{ "query": "...", "limit": 10 }` |
| `name: 'greet'` | `POST /greet` | `{ "name": "World" }` |

### Method, path & query params

Three optional action fields control REST routing and where each input field is read from:

- **`method`** - `'GET' | 'POST' | 'PUT' | 'DELETE'`. Defaults to `POST`, or `GET` when `kind: 'query'`. An explicit `method` always wins.
- **`path`** - route template, optionally with `:param` placeholders (e.g. `'spaces/:spaceId/users'`). Each placeholder must be a key of the input schema and is resolved from the URL path. When unset, the route is `/{action.name}`.
- **`queryParams`** - input fields read from the URL query string instead of the body (e.g. `['offset', 'limit']`). On a bodyless `GET`, every non-path field is read from the query string automatically.

```typescript
const ListUsers = createAction({
  name: 'list.users',
  kind: 'query',                    // ⇒ GET
  path: 'spaces/:spaceId/users',    // GET /spaces/:spaceId/users
  queryParams: ['offset', 'limit'],
  input: z.object({
    spaceId: z.string(),                    // from the path
    offset: z.int().optional().default(0),  // from ?offset=
    limit: z.int().optional().default(10)   // from ?limit=
  }),
  output: z.object({ users: z.array(z.object({ id: z.string() })) }),
  run: async ({ spaceId, offset, limit }) => ({ users: [/* ... */] })
})
```

```bash
curl 'http://localhost:8080/spaces/acme/users?offset=20&limit=10'
```

The input is merged from path + query + body (precedence: body → query → path) and validated per-source with the generated JSON Schema. The path placeholders, query params, and body each get their own OpenAPI parameters/requestBody, and validation failures return `400 { "error": "validation_error", "issues": [...] }`. A `:param` or `queryParams` entry that isn't in the input schema throws at startup.

## Resource Results (binary)

An action with a `binary()` output (see [`@silkweave/core`](https://www.npmjs.com/package/@silkweave/core)) - or any action returning a `resource()`, `File`/`Blob`, or bare bytes - responds with the **raw payload** instead of JSON:

- `Content-Type` from the resource's media type
- `Content-Disposition: inline; filename="..."` when the resource carries a `name`
- `Content-Description` when it carries a `description`

```bash
curl 'http://localhost:8080/screenshot?url=https://example.com' > shot.png
```

The route's OpenAPI response documents the payload as `type: string, format: binary` under the declared media type.

## Streaming Actions

Actions defined with a `chunk` schema and an `async function*` `run` (see [`@silkweave/core`](https://www.npmjs.com/package/@silkweave/core)) are exposed on the same `POST /{action.name}` route, but the response shape depends on the request's `Accept` header:

| `Accept` header | Response format |
|---|---|
| `text/event-stream` | Server-Sent Events. One `data: <chunk-json>\n\n` block per yielded chunk, terminated with `event: done\ndata: {}\n\n`. Errors come through as `event: error\ndata: <error-json>\n\n`. |
| `application/x-ndjson` (or `application/ndjson`) | Newline-delimited JSON. One JSON chunk per line; errors are written as a final JSON line and the stream is closed. |
| anything else (or omitted) | Buffered fallback - the action runs to completion and the chunks are returned as a JSON array with `200 OK`. |

Backpressure flows end-to-end: the adapter awaits `socket.drain` between chunks before pulling the next value from your generator, so a slow client throttles the action rather than buffering chunks unboundedly.

```bash
# SSE
curl -N -H 'Accept: text/event-stream' \
  -H 'Content-Type: application/json' \
  -d '{"topic":"weather","count":5}' \
  http://localhost:8080/generate-messages

# NDJSON
curl -N -H 'Accept: application/x-ndjson' \
  -H 'Content-Type: application/json' \
  -d '{"topic":"weather","count":5}' \
  http://localhost:8080/generate-messages

# Buffered
curl -H 'Content-Type: application/json' \
  -d '{"topic":"weather","count":5}' \
  http://localhost:8080/generate-messages
```

## Options

`FastifyAdapterOptions` extends Fastify's native `FastifyHttpOptions`, so any Fastify config is supported:

```typescript
fastify({
  host: 'localhost',
  port: 8080,
  logger: {
    level: 'debug',
    transport: { target: 'pino-pretty' }
  },
  connectionTimeout: 30000
})
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `host` | `string` | `undefined` | Bind address |
| `port` | `number` | `undefined` | Listen port |
| `cors` | `FastifyCorsOptions \| boolean` | `undefined` | CORS config. `false` to disable, `true`/omit for permissive defaults (`origin: '*'`), or a [@fastify/cors](https://www.npmjs.com/package/@fastify/cors) options object. |
| *...* | | | Any `FastifyHttpOptions` |

## See Also

- [Silkweave README](https://github.com/silkweave/silkweave) - Full documentation
- [`@silkweave/core`](https://www.npmjs.com/package/@silkweave/core) - Core library
