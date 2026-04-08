/* eslint-disable @typescript-eslint/no-explicit-any */
import { intro, log } from '@clack/prompts'
import { Action, AdapterFactory, SilkweaveError, unwrap } from '@silkweave/core'
import { createCLILogger } from '@silkweave/logger'
import { camelCase, kebabCase } from 'change-case'
import { Command } from 'commander'
import z from 'zod'

function handleCLIError(error: unknown) {
  if (error instanceof SilkweaveError) {
    log.error(`[${error.code}] ${error.message}`)
    process.exitCode = 1
  } else if (error instanceof z.ZodError) {
    log.error('Validation Error', { withGuide: false })
    for (const issue of error.issues) {
      log.error(`${issue.path}: ${issue.message}`)
    }
    process.exitCode = 1
  } else if (error instanceof Error) {
    log.error(error.message)
    process.exitCode = 1
  } else if (typeof error === 'string') {
    log.error(error)
    process.exitCode = 1
  } else {
    log.error(JSON.stringify(error))
    process.exitCode = 1
  }
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
          const name = kebabCase(action.name)
          const command = program.command(name).description(action.description)
          const shape = action.input.shape
          const keys = Object.keys(shape)
          for (const key of keys) {
            const [type, { defaultValue }] = unwrap(shape[key])
            const description = type.description
            const isArgument = action.args?.includes(key)
            if (isArgument) {
              command.argument(`[${camelCase(key)}]`, description, defaultValue)
            } else if (type instanceof z.ZodBoolean) {
              command.option(`--${kebabCase(key)}`, description, defaultValue)
              command.option(`--no-${kebabCase(key)}`)
            } else if (type instanceof z.ZodNumber) {
              command.option(`--${kebabCase(key)} <number>`, description, defaultValue)
            } else if (type instanceof z.ZodString || type instanceof z.ZodEnum) {
              command.option(`--${kebabCase(key)} <string>`, description, defaultValue)
            } else if (type instanceof z.ZodObject || type instanceof z.ZodRecord || type instanceof z.ZodArray) {
              command.option(`--${kebabCase(key)} <json>`, description ?? '', JSON.parse, defaultValue)
            } else {
              throw new Error(`Invalid zod type: ${type.def.type}`)
            }
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
        program.parse()
      },
      stop: async () => { }
    }
  }
}
