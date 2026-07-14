import { Client } from '@modelcontextprotocol/sdk/client'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { ContentBlock, LoggingMessageNotificationSchema, ProgressNotificationSchema, ToolResultContent } from '@modelcontextprotocol/sdk/types.js'
import { AdapterFactory, createConsoleLogger } from '@silkweave/core'
import { camelCase, kebabCase } from 'change-case'
import { Command } from 'commander'
import { randomUUID } from 'crypto'
import { parseResourceMessage } from '../util/result.js'

export type CLIFormatterFn = (message: ContentBlock, index: number, messages: ContentBlock[]) => string | undefined

export interface CliProxyOptions {
  url: URL
  formatter?: CLIFormatterFn
}

interface JsonSchemaProperty {
  type?: 'string' | 'number' | 'integer' | 'boolean' | 'object' | 'array' | string
  description?: string
  default?: unknown
  enum?: unknown[]
}

interface JsonSchemaObject {
  type?: 'object'
  properties?: Record<string, JsonSchemaProperty>
  required?: string[]
}

function coerce(value: unknown, type: JsonSchemaProperty['type']): unknown {
  if (value === undefined) { return undefined }
  if (type === 'number' || type === 'integer') {
    const n = Number(value)
    return Number.isNaN(n) ? value : n
  }
  return value
}

function addCliOption(command: Command, key: string, prop: JsonSchemaProperty) {
  const flag = kebabCase(key)
  const description = prop.description
  const defaultValue = prop.default
  const type = prop.type
  if (type === 'boolean') {
    command.option(`--${flag}`, description, defaultValue as boolean | undefined)
    command.option(`--no-${flag}`)
    return
  }
  if (type === 'number' || type === 'integer') {
    command.option(`--${flag} <number>`, description, defaultValue as string | undefined)
    return
  }
  if (type === 'string' || prop.enum) {
    command.option(`--${flag} <string>`, description, defaultValue as string | undefined)
    return
  }
  if (type === 'object' || type === 'array') {
    command.option(`--${flag} <json>`, description ?? '', JSON.parse, defaultValue as never)
    return
  }
  throw new Error(`Unsupported JSON Schema type for CLI option "${key}": ${type ?? 'undefined'}`)
}

const defaultFormatter: CLIFormatterFn = (message) => {
  if (message.type === 'text' && !message.text.includes('mcp://toolResult/')) {
    return `${message.text}`
  } else if (message.type === 'resource') {
    return parseResourceMessage(message)
  } else {
    return JSON.stringify(message)
  }
}

export const cliProxy: AdapterFactory<CliProxyOptions> = ({ url, formatter = defaultFormatter }) => {
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
          const schema = tool.inputSchema as JsonSchemaObject
          const properties = schema.properties ?? {}
          for (const key of Object.keys(properties)) {
            addCliOption(command, key, properties[key])
          }
          command.action(async (args: Record<string, unknown>) => {
            const { silent } = program.opts<{ silent: boolean }>()
            const logger = createConsoleLogger()
            if (!silent) {
              console.info(`${options.name} - ${tool.name}`)
              client.setNotificationHandler(LoggingMessageNotificationSchema, ({ params: { level, data } }) => {
                logger[level](data)
              })
              client.setNotificationHandler(ProgressNotificationSchema, ({ params: { progress, total, message } }) => {
                logger.info({ progress, total, message })
              })
            }
            const input: Record<string, unknown> = {}
            for (const key of Object.keys(properties)) {
              // Options register as kebab-case flags (--action-id) and Commander stores them
              // camelized (actionId) — read back via camelCase(key) so snake_case schema keys
              // (action_id) map too, not just single-word ones.
              const value = args[camelCase(key)]
              if (value !== undefined) { input[key] = coerce(value, properties[key]?.type) }
            }
            const response = await client.callTool({
              name: tool.name,
              arguments: input,
              _meta: { progressToken: randomUUID(), disposition: 'json' }
            }) as ToolResultContent
            response.content.forEach((message, index, messages) => {
              const text = formatter(message, index, messages)
              process.stdout.write(`${text}\n`)
            })
          })
        }
        await program.parseAsync()
        await transport.close()
      },
      stop: async () => { /* noop */ }
    }
  }
}
