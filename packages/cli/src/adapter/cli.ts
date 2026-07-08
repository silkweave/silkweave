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
  const rawInput = tmpArgs.pop()
  action.args?.forEach((k, index) => { rawInput[k] = args[index] })
  const { error, data } = action.input.safeParse(rawInput)
  if (error || !data) {
    handleCLIError(error)
    process.exit()
  }

  return data
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
  } else if (type instanceof z.ZodNumber) {
    command.option(`--${flag} <number>`, description, defaultValue)
  } else if (type instanceof z.ZodString || type instanceof z.ZodEnum) {
    command.option(`--${flag} <string>`, description, defaultValue)
  } else if (type instanceof z.ZodObject || type instanceof z.ZodRecord || type instanceof z.ZodArray) {
    command.option(`--${flag} <json>`, description ?? '', JSON.parse, defaultValue)
  } else {
    throw new Error(`Invalid zod type: ${type.def.type}`)
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
  for (const key of Object.keys(shape)) {
    const [type, { defaultValue }] = unwrap(shape[key])
    addCliOption(command, key, type, defaultValue, action.args?.includes(key) ?? false)
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
