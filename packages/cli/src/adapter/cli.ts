/* eslint-disable @typescript-eslint/no-explicit-any */
import { Action, ActionRun, ActionStreamRun, AdapterFactory, createConsoleLogger, isStreamingAction, SilkweaveContext, SilkweaveError, SilkweaveOptions, unwrap } from '@silkweave/core'
import { camelCase, kebabCase } from 'change-case'
import { Command } from 'commander'
import { once } from 'events'
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
    if (value !== undefined) { rawInput[key] = value }
  }
  action.args?.forEach((k, index) => { rawInput[String(k)] = args[index] })
  const { error, data } = action.input.safeParse(rawInput)
  if (error || !data) {
    handleCLIError(error)
    process.exit()
  }

  return data
}

/**
 * Map a Zod option type to its commander placeholder and, when the value needs
 * coercing from commander's raw string, a `parseArg`. Numeric/bigint/json fields
 * MUST carry a parser - without it every z.number() field fails Zod with
 * `expected number, received string`.
 */
function optionSpec(type: z.ZodType): { placeholder: string; parseArg?: (value: string) => unknown } {
  if (type instanceof z.ZodNumber) {
    return { placeholder: '<number>', parseArg: (value) => Number(value) }
  }
  if (type instanceof z.ZodBigInt) {
    return { placeholder: '<bigint>', parseArg: (value) => { try { return BigInt(value) } catch { return value } } }
  }
  if (type instanceof z.ZodString || type instanceof z.ZodEnum) {
    return { placeholder: '<string>' }
  }
  if (type instanceof z.ZodObject || type instanceof z.ZodRecord || type instanceof z.ZodArray) {
    return { placeholder: '<json>', parseArg: JSON.parse }
  }
  throw new Error(`Invalid zod type: ${type.def.type}`)
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
  const { placeholder, parseArg } = optionSpec(type)
  if (parseArg) {
    command.option(`--${flag} ${placeholder}`, description ?? '', parseArg, defaultValue)
  } else {
    command.option(`--${flag} ${placeholder}`, description, defaultValue)
  }
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
  // Options first (order irrelevant), then positional arguments in `action.args`
  // order - not input-shape key order - so commander's positional slots line up
  // with how parseCLIInput reads them back (else the values are cross-assigned).
  for (const key of Object.keys(shape)) {
    if (argSet.has(key)) { continue }
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
    console.info(`${options.name} - ${action.name}`)
    const runFn = action.run as ActionRun<object, object>
    runFn(input, actionContext).then((result) => {
      logger.info(JSON.stringify(result, null, 2))
    }).catch(handleCLIError)
  })
}

export const cli: AdapterFactory = () => {
  return (options, baseContext) => {
    const context = baseContext.fork({ adapter: 'cli' })
    const program = new Command()
      .name(options.name)
      .description(options.description)
      .version(options.version)

    return {
      context,
      start: async (actions) => {
        for (const action of actions) {
          registerCommand(program, action, options, context)
        }
        program.parse()
      },
      stop: async () => { }
    }
  }
}
