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

Each action becomes a `POST /{action.name}` route. Zod schemas are converted to JSON Schema for request body validation and OpenAPI documentation.

| Action | Route | Body |
|--------|-------|------|
| `name: 'search'` | `POST /search` | `{ "query": "...", "limit": 10 }` |
| `name: 'greet'` | `POST /greet` | `{ "name": "World" }` |

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
