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
          const name = kebabCase(tool.name)
          const command = program.command(name)
          if (tool.description) { command.description(tool.description) }
          const schema = z.fromJSONSchema(tool.inputSchema as JSONSchema.JSONSchema)
          if (!(schema instanceof z.ZodObject)) { throw new Error('Invalid schema') }
          const shape = schema.shape
          const keys = Object.keys(shape)
          for (const key of keys) {
            const [type, { defaultValue }] = unwrap(shape[key])
            const description = type.description
            if (type instanceof z.ZodBoolean) {
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
        await program.parseAsync()
        await transport.close()
      },
      stop: async () => { }
    }
  }
}
