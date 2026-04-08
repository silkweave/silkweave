/* eslint-disable @typescript-eslint/no-explicit-any */
import { intro, log } from '@clack/prompts'
import { Action, AdapterFactory, SilkweaveError, SilkweaveOptions, unwrap } from '@silkweave/core'
import { createCLILogger } from '@silkweave/logger'
import { SilkweaveContext } from '@silkweave/core'
import { camelCase, kebabCase } from 'change-case'
import { Command } from 'commander'
import z from 'zod'

function handleCLIError(error: unknown) {
  if (error instanceof SilkweaveError) {
    log.error(`[${error.code}] ${error.message}`)
  } else if (error instanceof z.ZodError) {
    log.error('Validation Error', { withGuide: false })
    for (const issue of error.issues) {
      log.error(`${issue.path}: ${issue.message}`)
    }
  } else if (error instanceof Error) {
    log.error(error.message)
  } else if (typeof error === 'string') {
    log.error(error)
  } else {
    log.error(JSON.stringify(error))
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

function registerCommand(program: Command, action: Action, options: SilkweaveOptions, context: SilkweaveContext) {
  const command = program.command(kebabCase(action.name)).description(action.description)
  const shape = action.input.shape
  for (const key of Object.keys(shape)) {
    const [type, { defaultValue }] = unwrap(shape[key])
    addCliOption(command, key, type, defaultValue, action.args?.includes(key) ?? false)
  }
  command.action((...args) => {
    const logger = createCLILogger()
    const input = parseCLIInput(action, args)
    intro(`${options.name} - ${action.name}`)
    action.run(input, context.fork({ logger, command })).then((result) => {
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
