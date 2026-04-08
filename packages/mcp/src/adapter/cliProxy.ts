import { intro } from '@clack/prompts'
import { Client } from '@modelcontextprotocol/sdk/client'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { LoggingMessageNotificationSchema, ProgressNotificationSchema } from '@modelcontextprotocol/sdk/types'
import { AdapterFactory, parseToolResponse, ToolResponse, unwrap } from '@silkweave/core'
import { createCLILogger } from '@silkweave/logger'
import { kebabCase } from 'change-case'
import { Command } from 'commander'
import { randomUUID } from 'crypto'
import { z } from 'zod'
import { JSONSchema } from 'zod/v4/core'

export interface CliProxyOptions {
  url: URL
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function addCliOption(command: Command, key: string, type: z.ZodType, defaultValue: any) {
  const description = type.description
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
/* eslint-enable @typescript-eslint/no-explicit-any */

function registerProxyCommand(
  program: Command,
  client: Client,
  tool: { name: string; description?: string; inputSchema: object },
  options: { name: string; version: string; description: string }
) {
  const name = kebabCase(tool.name)
  const command = program.command(name)
  if (tool.description) { command.description(tool.description) }
  const schema = z.fromJSONSchema(tool.inputSchema as JSONSchema.JSONSchema)
  if (!(schema instanceof z.ZodObject)) { throw new Error('Invalid schema') }
  const shape = schema.shape
  for (const key of Object.keys(shape)) {
    const [type, { defaultValue }] = unwrap(shape[key])
    addCliOption(command, key, type, defaultValue)
  }
  command.action(async (args) => {
    const { silent } = program.opts<{ silent: boolean }>()
    const logger = createCLILogger()
    if (!silent) {
      intro(`${options.name} - ${tool.name}`)
      client.setNotificationHandler(LoggingMessageNotificationSchema, ({ params: { level, data } }) => {
        logger[level](data)
      })
      client.setNotificationHandler(ProgressNotificationSchema, ({ params: { progress, total, message } }) => {
        logger.info({ progress, total, message })
      })
    }
    const input = await schema.parseAsync(args)
    const response = await client.callTool({
      name: tool.name,
      arguments: input,
      _meta: { progressToken: randomUUID() }
    })
    const result = parseToolResponse(response as ToolResponse)
    process.stdout.write(JSON.stringify(result, null, 2))
  })
}

export const cliProxy: AdapterFactory<CliProxyOptions> = ({ url }) => {
  return (options, baseContext) => {
    const context = baseContext.fork({ adapter: 'cliProxy' })
    const program = new Command()
      .name(options.name)
      .description(options.description)
      .version(options.version)
      .option('-s, --silent', 'Silent mode, prevent log messages', false)

    return {
      context,
      start: async () => {
        const client = new Client({
          name: options.name,
          description: options.description,
          version: options.version
        })
        const transport = new StreamableHTTPClientTransport(url)
        await client.connect(transport)
        const { tools } = await client.listTools()
        for (const tool of tools) {
          registerProxyCommand(program, client, tool, options)
        }
        await program.parseAsync()
        await transport.close()
      },
      stop: async () => { }
    }
  }
}
