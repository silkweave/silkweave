# @silkweave/core

Core library for [Silkweave](https://github.com/silkweave/silkweave) — the TypeScript toolkit for building MCP servers and CLI tools from a single set of Actions.

## Install

```bash
pnpm add @silkweave/core
```

## What's Inside

This package provides the foundational building blocks that all Silkweave adapters depend on:

- **`silkweave()`** — Fluent builder to wire up adapters and actions
- **`createAction()`** — Define transport-agnostic actions with Zod input schemas
- **Adapter types** — `Adapter`, `AdapterGenerator`, `AdapterFactory` interfaces for building custom adapters
- **Context** — `SilkweaveContext` key-value store with `fork()` for per-adapter/per-request isolation
- **MCP utilities** — `toolResponse()`, `parseToolResponse()` for MCP response formatting
- **Sideload resources** — `createSideloadResource()` for binary resource handling
- **Zod utilities** — `unwrap()` to recursively unwrap Zod wrapper types

## Usage

```typescript
import { silkweave, createAction } from '@silkweave/core'
import z from 'zod'

const GreetAction = createAction({
  name: 'greet',
  description: 'Greet someone by name',
  input: z.object({
    name: z.string().describe('Name to greet')
  }),
  run: async ({ name }, context) => {
    return { message: `Hello, ${name}!` }
  }
})

// Wire up with any adapter
await silkweave({ name: 'my-app', description: 'My App', version: '1.0.0' })
  .adapter(someAdapter)
  .action(GreetAction)
  .start()
```

## API

### `silkweave(options): Silkweave`

| Option | Type | Description |
|--------|------|-------------|
| `name` | `string` | Server/app name |
| `description` | `string` | Human-readable description |
| `version` | `string` | Semantic version |

Returns a builder with `.adapter()`, `.action()`, `.actions()`, `.set()`, and `.start()`.

### `createAction(action): Action`

| Field | Type | Description |
|-------|------|-------------|
| `name` | `string` | Unique action identifier |
| `description` | `string` | Human-readable description |
| `input` | `z.ZodObject` | Zod schema for input validation |
| `args` | `(keyof I)[]` | Fields to expose as CLI positional arguments |
| `isEnabled` | `(context) => boolean` | Gate action availability per adapter |
| `run` | `(input, context) => Promise<O>` | The action implementation |

### Adapter Interfaces

```typescript
interface Adapter {
  context: SilkweaveContext
  start(actions: Action[]): Promise<void>
  stop(): Promise<void>
}

type AdapterGenerator = (options: SilkweaveOptions, baseContext: SilkweaveContext) => Adapter
type AdapterFactory<T = void> = (options: T) => AdapterGenerator
```

## See Also

- [Silkweave README](https://github.com/silkweave/silkweave) — Full documentation
- [`@silkweave/mcp`](https://www.npmjs.com/package/@silkweave/mcp) — MCP stdio and HTTP adapters
- [`@silkweave/fastify`](https://www.npmjs.com/package/@silkweave/fastify) — Fastify REST adapter
- [`@silkweave/cli`](https://www.npmjs.com/package/@silkweave/cli) — CLI adapter
- [`@silkweave/vercel`](https://www.npmjs.com/package/@silkweave/vercel) — Vercel serverless adapter
