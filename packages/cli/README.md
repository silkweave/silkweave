# @silkweave/cli

CLI adapter for [Silkweave](https://github.com/silkweave/silkweave) - turn your actions into a complete command-line application with help text, option parsing, and styled terminal output via clack.

## Install

```bash
pnpm add @silkweave/core @silkweave/cli
```

## Usage

```typescript
import { silkweave } from '@silkweave/core'
import { cli } from '@silkweave/cli'
import { GreetAction } from './actions/greet.js'

await silkweave({ name: 'mytool', description: 'My CLI Tool', version: '1.0.0' })
  .adapter(cli())
  .action(GreetAction)
  .start()
```

```
$ mytool greet --name "World" --enthusiastic
◇ mytool - greet
ℹ HELLO, WORLD!!!
```

## How Zod Types Map to CLI Options

| Zod Type | CLI Representation |
|----------|-------------------|
| `z.string()` | `--option-name <string>` |
| `z.number()` | `--option-name <number>` |
| `z.boolean()` | `--option-name` / `--no-option-name` |
| `z.enum([...])` | `--option-name <choice>` with choices validation |
| `z.record()` | `--option-name <json>` |
| `.default(value)` | Sets the default in help text |
| `.describe('...')` | Sets the option description |

Field names are automatically converted to `kebab-case`. Action names become subcommands.

## Positional Arguments

Use the `args` property on an action to promote fields to positional arguments:

```typescript
const DeployAction = createAction({
  name: 'deploy',
  input: z.object({
    environment: z.string(),
    dryRun: z.boolean().default(false)
  }),
  args: ['environment'],
  // ...
})
```

```
$ mytool deploy production --dry-run
```

## See Also

- [Silkweave README](https://github.com/silkweave/silkweave) - Full documentation
- [`@silkweave/core`](https://www.npmjs.com/package/@silkweave/core) - Core library
