# @silkweave/cli

CLI adapter for [Silkweave](https://github.com/silkweave/silkweave) - turn your actions into a complete command-line application with help text, option parsing, and plain `console` output.

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

## Streaming Actions

Actions defined with a `chunk` schema and an `async function*` `run` (see [`@silkweave/core`](https://www.npmjs.com/package/@silkweave/core)) stream output as **NDJSON on stdout** - one JSON-encoded chunk per line, so the output is pipe-friendly.

```bash
$ mytool generate-messages --topic weather --count 3
{"index":0,"text":"Message 1 about weather"}
{"index":1,"text":"Message 2 about weather"}
{"index":2,"text":"Message 3 about weather"}

$ mytool generate-messages --topic weather --count 100 | jq -r '.text' | head -5
Message 1 about weather
Message 2 about weather
...
```

Backpressure is honoured: each chunk write awaits `stdout`'s `drain` event when the buffer is full, so the action throttles itself if a downstream pipe is slow.

## Resource Results (binary)

An action with a `binary()` output (see [`@silkweave/core`](https://www.npmjs.com/package/@silkweave/core)) - or any action returning a `resource()`, `File`/`Blob`, or bare bytes - delivers its payload terminal-appropriately; binary is **never dumped onto an interactive terminal**:

```bash
# Piped: raw bytes on stdout (description + status go to stderr)
$ mytool screenshot --url https://example.com > shot.png

# Interactive: written to --output, or a file named after the resource
$ mytool screenshot --url https://example.com --output shot.png
Wrote 48213 bytes (image/png) to shot.png
```

The `-o, --output <path>` flag is added automatically for `binary()` actions (unless the input schema already has an `output` field, which then wins). The command banner moves to stderr for binary actions so a piped stdout stays byte-clean.

## See Also

- [Silkweave README](https://github.com/silkweave/silkweave) - Full documentation
- [`@silkweave/core`](https://www.npmjs.com/package/@silkweave/core) - Core library
