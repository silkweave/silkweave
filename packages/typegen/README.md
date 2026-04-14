# @silkweave/typegen

> Build-time `.d.ts` generation from Silkweave action Zod schemas

## Install

```bash
pnpm add @silkweave/typegen
```

Requires `typescript` >= 5.0 as a peer dependency (already present in any TypeScript project).

## Usage

Add the `typegen()` adapter to your Silkweave builder. On start, it walks every registered action's Zod input/output schema and writes typed interfaces to the specified path.

```ts
import { silkweave } from '@silkweave/core'
import { typegen } from '@silkweave/typegen'
import { GreetAction } from './actions/greet.js'

await silkweave({ name: 'my-server', version: '1.0.0' })
  .adapter(typegen({ path: 'types/actions.d.ts' }))
  .action(GreetAction)
  .start()
```

Given an action with:

```ts
const GreetAction = createAction({
  name: 'greet',
  input: z.object({ name: z.string() }),
  output: z.object({ message: z.string() }),
  run: async ({ name }) => ({ message: `Hello, ${name}!` })
})
```

This generates:

```ts
// types/actions.d.ts
export interface GreetInput {
    name: string;
}

export interface GreetOutput {
    message: string;
}
```

## Options

| Option | Type | Description |
|--------|------|-------------|
| `path` | `string` | Output file path for the generated `.d.ts` file. Directories are created automatically. |

## Combining with runtime adapters

Chain `typegen()` alongside any runtime adapter. It writes the file on start and has no other side effects:

```ts
import { silkweave } from '@silkweave/core'
import { stdio } from '@silkweave/mcp'
import { typegen } from '@silkweave/typegen'

await silkweave({ name: 'my-server', version: '1.0.0' })
  .adapter(stdio())
  .adapter(typegen({ path: 'types/actions.d.ts' }))
  .action(GreetAction)
  .start()
```

## How it works

- Uses the **TypeScript compiler API** (`ts.factory` + `ts.createPrinter`) to produce correct, well-formatted declarations
- Sets `allActions: true` on the adapter so **all** registered actions are included regardless of `isEnabled` guards
- Generates `{PascalName}Input` and `{PascalName}Output` interfaces per action
- Output interfaces are only generated when the action defines an `output` schema

## Supported Zod types

| Zod | TypeScript |
|-----|-----------|
| `z.string()` | `string` |
| `z.number()` | `number` |
| `z.boolean()` | `boolean` |
| `z.bigint()` | `bigint` |
| `z.date()` | `Date` |
| `z.enum(['a', 'b'])` | `'a' \| 'b'` |
| `z.literal('x')` | `'x'` |
| `z.array(z.string())` | `string[]` |
| `z.object({...})` | `{...}` (nested) |
| `z.record(z.string())` | `{[key: string]: string}` |
| `z.tuple([...])` | `[A, B]` |
| `z.union([...])` | `A \| B` |
| `z.intersection(A, B)` | `A & B` |
| `z.string().optional()` | `string \| undefined` |
| `z.string().nullable()` | `string \| null` |
| `z.string().default('x')` | `string` (optional field) |
| `z.set(z.string())` | `Set<string>` |
| `z.map(z.string(), z.number())` | `Map<string, number>` |
| `z.promise(z.string())` | `Promise<string>` |
| `z.string().readonly()` | `readonly string[]` (arrays/tuples) |

## Exports

| Export | Description |
|--------|-------------|
| `typegen(opts)` | Adapter factory - the main entry point |
| `generateDts(actions)` | Generate `.d.ts` string from an array of actions |
| `zodToTs(schema)` | Convert a single Zod schema to a TypeScript AST node |
