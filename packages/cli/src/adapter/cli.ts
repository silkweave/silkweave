import {
  Action,
  ActionRun,
  ActionStreamRun,
  AdapterFactory,
  binarySchemaMeta,
  createConsoleLogger,
  isBinarySchema,
  isStreamingAction,
  resourceBytes,
  SilkweaveContext,
  SilkweaveError,
  SilkweaveOptions,
  toActionResource,
  unwrap,
  type ActionResource
} from '@silkweave/core'
import { camelCase, kebabCase } from 'change-case'
import { Command } from 'commander'
import { once } from 'events'
import { writeFile } from 'fs/promises'
import z from 'zod/v4'

function handleCLIError(error: unknown) {
  if (error instanceof SilkweaveError) {
    console.error(`[${error.code}] ${error.message}`)
  } else if (error instanceof z.ZodError) {
    console.error('Validation Error')
    for (const issue of error.issues) {
      console.error(`${issue.path}: ${issue.message}`)
    }
  } else if (error instanceof Error) {
    console.error(error.message)
  } else if (typeof error === 'string') {
    console.error(error)
  } else {
    console.error(JSON.stringify(error))
  }
  process.exitCode = 1
}

function parseCLIInput(action: Action, args: any[]) {
  const tmpArgs = args.slice(0, -1)
  const opts = tmpArgs.pop()
  // Options register as kebab-case flags (--action-id) and Commander stores them
  // camelized (actionId) - read back via camelCase(key) so snake_case schema keys
  // (action_id) map too, not just single-word ones.
  const rawInput: Record<string, unknown> = {}
  for (const key of Object.keys(action.input.shape)) {
    const value = opts[camelCase(key)]
    if (value !== undefined) {
      rawInput[key] = value
    }
  }
  action.args?.forEach((k, index) => {
    rawInput[String(k)] = args[index]
  })
  const { error, data } = action.input.safeParse(rawInput)
  if (error || !data) {
    handleCLIError(error)
    process.exit()
  }

  return data
}

interface OptionSpec {
  placeholder: string
  parseArg?: (value: string) => unknown
}

/**
 * Tolerant JSON parse. A union arm is typically a scalar (`number | number[]`),
 * and commander hands scalars over as bare strings that are not valid JSON -
 * `--cost 3` must survive as `"3"` for Zod to coerce, while `--cost '[1,2]'`
 * parses. Throwing here would trade a build-time crash for a run-time one.
 */
function parseMaybeJson(value: string): unknown {
  try {
    return JSON.parse(value)
  } catch {
    return value
  }
}

/**
 * Render a literal-bearing option as its arms (`<a|b>`) rather than `<json>`,
 * and coerce only when it needs it: all-string literals arrive usable as-is,
 * anything else (numbers, booleans, null) has to be parsed back off the string.
 */
function literalSpec(values: readonly unknown[]): OptionSpec {
  const placeholder = `<${values.map((value) => String(value)).join('|')}>`
  if (values.every((value) => typeof value === 'string')) {
    return { placeholder }
  }
  return { placeholder, parseArg: parseMaybeJson }
}

/** The literal values every arm of a union carries, or undefined if any arm is not a literal. */
function literalUnionValues(options: readonly z.ZodType[]): unknown[] | undefined {
  const values: unknown[] = []
  for (const option of options) {
    if (!(option instanceof z.ZodLiteral)) {
      return undefined
    }
    values.push(...option.def.values)
  }
  return values
}

/**
 * Map a Zod option type to its commander placeholder and, when the value needs
 * coercing from commander's raw string, a `parseArg`. Numeric/bigint/json fields
 * MUST carry a parser - without it every z.number() field fails Zod with
 * `expected number, received string`.
 *
 * This runs while the command table is built, so an unsupported type takes the
 * whole binary down (`--help` included) - hence the key in the error message.
 */
function optionSpec(type: z.ZodType, key: string): OptionSpec {
  if (type instanceof z.ZodNumber) {
    return { placeholder: '<number>', parseArg: (value) => Number(value) }
  }
  if (type instanceof z.ZodBigInt) {
    return {
      placeholder: '<bigint>',
      parseArg: (value) => {
        try {
          return BigInt(value)
        } catch {
          return value
        }
      }
    }
  }
  if (type instanceof z.ZodString || type instanceof z.ZodEnum) {
    return { placeholder: '<string>' }
  }
  if (type instanceof z.ZodLiteral) {
    return literalSpec(type.def.values)
  }
  if (type instanceof z.ZodUnion) {
    const literals = literalUnionValues(type.def.options as readonly z.ZodType[])
    return literals ? literalSpec(literals) : { placeholder: '<json>', parseArg: parseMaybeJson }
  }
  if (type instanceof z.ZodObject || type instanceof z.ZodRecord || type instanceof z.ZodArray) {
    return { placeholder: '<json>', parseArg: JSON.parse }
  }
  throw new Error(`option "${key}": unsupported zod type ${type.def.type}`)
}

function addCliOption(command: Command, key: string, type: z.ZodType, defaultValue: any, isArgument: boolean) {
  const description = type.description
  if (isArgument) {
    command.argument(`[${camelCase(key)}]`, description, defaultValue)
    return
  }
  const flag = kebabCase(key)
  if (type instanceof z.ZodBoolean) {
    command.option(`--${flag}`, description, defaultValue)
    command.option(`--no-${flag}`)
    return
  }
  const { placeholder, parseArg } = optionSpec(type, key)
  if (parseArg) {
    command.option(`--${flag} ${placeholder}`, description ?? '', parseArg, defaultValue)
  } else {
    command.option(`--${flag} ${placeholder}`, description, defaultValue)
  }
}

/** File extension derived from a media type's subtype (`image/png` -> `png`). */
function extensionFromMime(mimeType: string): string {
  const subtype = mimeType.split(';')[0].split('/')[1]?.split('+')[0]?.trim()
  return subtype || 'bin'
}

/**
 * Deliver a resource result terminal-appropriately: raw bytes to stdout when
 * piped (`my-cli screenshot > shot.png`), otherwise written to `--output` or a
 * file named after the resource - binary is never dumped onto an interactive
 * terminal. Status lines go to stderr so a piped stdout stays byte-clean.
 */
async function writeResourceResult(res: ActionResource, outputPath: string | undefined) {
  const bytes = resourceBytes(res)
  if (res.description) {
    console.error(res.description)
  }
  if (!outputPath && !process.stdout.isTTY) {
    if (!process.stdout.write(bytes)) {
      await once(process.stdout, 'drain')
    }
    return
  }
  const target = outputPath ?? res.name ?? `resource.${extensionFromMime(res.mimeType)}`
  await writeFile(target, bytes)
  console.error(`Wrote ${bytes.length} bytes (${res.mimeType}) to ${target}`)
}

async function runStreamingCommand(action: Action, input: object, context: SilkweaveContext) {
  const streamRun = action.run as ActionStreamRun<object, unknown>
  const iter = streamRun(input, context)
  for await (const chunk of iter) {
    const line = JSON.stringify(chunk) + '\n'
    if (!process.stdout.write(line)) {
      await once(process.stdout, 'drain')
    }
  }
}

function registerCommand(program: Command, action: Action, options: SilkweaveOptions, context: SilkweaveContext) {
  const command = program.command(kebabCase(action.name)).description(action.description)
  const shape = action.input.shape
  const argKeys = action.args ?? []
  const argSet = new Set(argKeys)
  // Binary actions get an --output flag - unless the input schema claims the
  // name, in which case the schema field wins and only pipe/TTY behavior applies.
  const binaryOutput = isBinarySchema(action.output) && !('output' in shape)
  if (binaryOutput) {
    command.option('-o, --output <path>', 'Write the resource to this file (default: the resource name)')
  }
  // Options first (order irrelevant), then positional arguments in `action.args`
  // order - not input-shape key order - so commander's positional slots line up
  // with how parseCLIInput reads them back (else the values are cross-assigned).
  for (const key of Object.keys(shape)) {
    if (argSet.has(key)) {
      continue
    }
    const [type, { defaultValue }] = unwrap(shape[key])
    addCliOption(command, key, type, defaultValue, false)
  }
  for (const argKey of argKeys) {
    const key = String(argKey)
    const [type, { defaultValue }] = unwrap(shape[key])
    addCliOption(command, key, type, defaultValue, true)
  }
  command.action((...args) => {
    const logger = createConsoleLogger()
    const input = parseCLIInput(action, args)
    const actionContext = context.fork({ logger, command })
    if (isStreamingAction(action)) {
      runStreamingCommand(action, input, actionContext).catch(handleCLIError)
      return
    }
    // Binary actions keep stdout byte-clean (a piped stdout carries the
    // payload), so the banner goes to stderr for them.
    if (binaryOutput) {
      console.error(`${options.name} - ${action.name}`)
    } else {
      console.info(`${options.name} - ${action.name}`)
    }
    const runFn = action.run as ActionRun<object, object>
    runFn(input, actionContext)
      .then(async (result) => {
        const res = await toActionResource(result, binarySchemaMeta(action.output))
        if (res) {
          await writeResourceResult(res, binaryOutput ? command.opts<{ output?: string }>().output : undefined)
          return
        }
        logger.info(JSON.stringify(result, null, 2))
      })
      .catch(handleCLIError)
  })
}

export const cli: AdapterFactory = () => {
  return (options, baseContext) => {
    const context = baseContext.fork({ adapter: 'cli' })
    const program = new Command().name(options.name).description(options.description).version(options.version)

    return {
      context,
      start: async (actions) => {
        for (const action of actions) {
          registerCommand(program, action, options, context)
        }
        program.parse()
      },
      stop: async () => {}
    }
  }
}
