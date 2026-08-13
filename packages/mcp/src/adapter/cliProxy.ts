import { Client } from '@modelcontextprotocol/sdk/client'
import { UnauthorizedError, type OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth.js'
import { StreamableHTTPClientTransport, StreamableHTTPError } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { FetchLike } from '@modelcontextprotocol/sdk/shared/transport.js'
import {
  ContentBlock,
  LoggingMessageNotificationSchema,
  ProgressNotificationSchema,
  Tool,
  ToolResultContent
} from '@modelcontextprotocol/sdk/types.js'
import { AdapterFactory, base64ToBytes, createConsoleLogger, isTextMimeType } from '@silkweave/core'
import { camelCase, kebabCase } from 'change-case'
import { Command } from 'commander'
import { randomUUID } from 'crypto'
import { once } from 'events'
import { writeFile } from 'fs/promises'
import { parseResourceMessage } from '../util/result.js'

export type CLIFormatterFn = (message: ContentBlock, index: number, messages: ContentBlock[]) => string | undefined

export interface CliProxyOptions {
  url: URL
  formatter?: CLIFormatterFn
  /**
   * Extra headers sent on every request (e.g. `{ authorization: 'Bearer …' }`),
   * merged over `requestInit.headers`. A thunk is resolved once per CLI
   * invocation, before connecting - use it to read a token lazily from config.
   * For token refresh flows, use `authProvider` instead.
   */
  headers?: Record<string, string> | (() => Record<string, string> | Promise<Record<string, string>>)
  /** Passed through to `StreamableHTTPClientTransport` (headers merged over its `headers`). */
  requestInit?: RequestInit
  /** Custom fetch implementation, passed through to the transport. */
  fetch?: FetchLike
  /** OAuth provider for full auth flows, passed through to the transport. */
  authProvider?: OAuthClientProvider
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
  if (value === undefined) {
    return undefined
  }
  if (type === 'number' || type === 'integer') {
    const n = Number(value)
    return Number.isNaN(n) ? value : n
  }
  // Positional values always arrive as raw strings (commander parsers only run
  // on options), so booleans and json need coercing here too. Option values
  // never hit these branches - flags parse booleans and --json flags carry a
  // JSON.parse parser - so this only widens the positional path.
  if (type === 'boolean' && typeof value === 'string') {
    return value === 'true'
  }
  if ((type === 'object' || type === 'array') && typeof value === 'string') {
    try {
      return JSON.parse(value)
    } catch {
      return value
    }
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

function addCliArgument(command: Command, key: string, prop: JsonSchemaProperty, required: boolean) {
  const name = camelCase(key)
  // Required positionals get <angle> brackets so commander enforces arity and
  // --help shows the distinction; optional ones get [square] brackets.
  if (required) {
    command.argument(`<${name}>`, prop.description)
  } else {
    command.argument(`[${name}]`, prop.description, prop.default)
  }
}

/**
 * Positional-argument keys published by silkweave servers in the tool's
 * `_meta` (`registerTools` emits `silkweave/args` from `action.args`). Unknown
 * keys are dropped defensively - a stale or foreign server must not break the
 * whole CLI.
 */
function positionalKeys(tool: Tool, properties: Record<string, JsonSchemaProperty>): string[] {
  return ((tool._meta?.['silkweave/args'] as string[] | undefined) ?? []).filter((key) => key in properties)
}

/** Assemble the tool-call input from commander's option values and positionals. */
function buildToolInput(
  properties: Record<string, JsonSchemaProperty>,
  argKeys: string[],
  positionals: unknown[],
  opts: Record<string, unknown>
): Record<string, unknown> {
  const argSet = new Set(argKeys)
  const input: Record<string, unknown> = {}
  for (const key of Object.keys(properties)) {
    if (argSet.has(key)) {
      continue
    }
    // Options register as kebab-case flags (--action-id) and Commander stores them
    // camelized (actionId) - read back via camelCase(key) so snake_case schema keys
    // (action_id) map too, not just single-word ones.
    const value = opts[camelCase(key)]
    if (value !== undefined) {
      input[key] = coerce(value, properties[key]?.type)
    }
  }
  argKeys.forEach((key, index) => {
    const value = positionals[index]
    if (value !== undefined) {
      input[key] = coerce(value, properties[key]?.type)
    }
  })
  return input
}

interface BinaryPayload {
  bytes: Uint8Array
  mimeType: string
  name?: string
}

/**
 * The decodable binary payload of a content block: `image`/`audio` blocks, and
 * embedded resources whose `blob` carries a non-text media type. Text
 * resources (including smart-disposition offloads) stay on the text path and
 * print as before.
 */
function binaryPayload(block: ContentBlock): BinaryPayload | undefined {
  if (block.type === 'image' || block.type === 'audio') {
    return { bytes: base64ToBytes(block.data), mimeType: block.mimeType }
  }
  if (block.type === 'resource' && 'blob' in block.resource) {
    const mimeType = block.resource.mimeType ?? 'application/octet-stream'
    if (isTextMimeType(mimeType)) {
      return undefined
    }
    // Server-side resource URIs end in `/<name>` when the action named the
    // artifact (`mcp://toolResult/<uuid>/shot.png`); a bare uuid tail is not a
    // usable file name.
    const tail = block.resource.uri.split('/').pop()
    return {
      bytes: base64ToBytes(block.resource.blob),
      mimeType,
      ...(tail?.includes('.') ? { name: tail } : {})
    }
  }
  return undefined
}

/** File extension derived from a media type's subtype (`image/png` -> `png`). */
function extensionFromMime(mimeType: string): string {
  const subtype = mimeType.split(';')[0].split('/')[1]?.split('+')[0]?.trim()
  return subtype || 'bin'
}

/**
 * Deliver decoded binary payloads terminal-appropriately: raw bytes to stdout
 * when piped, otherwise written to `--output` or a file named after the
 * resource - binary is never dumped onto an interactive terminal. Status lines
 * go to stderr so a piped stdout stays byte-clean.
 */
async function writeBinaryPayloads(binaries: BinaryPayload[], outputPath: string | undefined) {
  if (!outputPath && !process.stdout.isTTY) {
    if (binaries.length > 1) {
      console.error(`(${binaries.length} binary parts - writing the first to stdout)`)
    }
    if (!process.stdout.write(binaries[0].bytes)) {
      await once(process.stdout, 'drain')
    }
    return
  }
  for (const [index, bin] of binaries.entries()) {
    const target =
      (index === 0 ? outputPath : undefined) ??
      bin.name ??
      `resource${index ? `-${index}` : ''}.${extensionFromMime(bin.mimeType)}`
    await writeFile(target, bin.bytes)
    console.error(`Wrote ${bin.bytes.length} bytes (${bin.mimeType}) to ${target}`)
  }
}

/** Bridge the server's log + progress notifications onto the console. */
export function attachNotificationLogging(client: Client) {
  const logger = createConsoleLogger()
  client.setNotificationHandler(LoggingMessageNotificationSchema, ({ params: { level, data } }) => {
    logger[level](data)
  })
  client.setNotificationHandler(ProgressNotificationSchema, ({ params: { progress, total, message } }) => {
    logger.info({ progress, total, message })
  })
}

/** Register one remote tool as a commander subcommand. */
export function registerToolCommand(
  program: Command,
  client: Client,
  tool: Tool,
  formatter: CLIFormatterFn,
  cliName: string
) {
  const command = program.command(kebabCase(tool.name))
  if (tool.description) {
    command.description(tool.description)
  }
  const schema = tool.inputSchema as JsonSchemaObject
  const properties = schema.properties ?? {}
  const requiredKeys = new Set(schema.required ?? [])
  const argKeys = positionalKeys(tool, properties)
  const argSet = new Set(argKeys)
  // Options first (order irrelevant), then positional arguments in
  // `silkweave/args` order - not schema-key order - so commander's positional
  // slots line up with how the action handler reads them back (else the
  // values are cross-assigned).
  for (const key of Object.keys(properties)) {
    if (argSet.has(key)) {
      continue
    }
    addCliOption(command, key, properties[key])
  }
  for (const key of argKeys) {
    addCliArgument(command, key, properties[key], requiredKeys.has(key))
  }
  // Every proxied tool may return binary content; --output routes it to a file.
  // A schema field named `output` wins the flag - pipe/TTY behavior still applies.
  const hasOutputOption = !('output' in properties)
  if (hasOutputOption) {
    command.option('-o, --output <path>', 'Write a binary result to this file (default: the resource name)')
  }
  command.action(async (...cliArgs: unknown[]) => {
    // commander passes positionals first, then the options object (the
    // Command instance trails and is ignored).
    const positionals = cliArgs.slice(0, argKeys.length)
    const opts = cliArgs[argKeys.length] as Record<string, unknown>
    const { silent } = program.opts<{ silent: boolean }>()
    if (!silent) {
      console.info(`${cliName} - ${tool.name}`)
      attachNotificationLogging(client)
    }
    const response = (await client.callTool({
      name: tool.name,
      arguments: buildToolInput(properties, argKeys, positionals, opts),
      _meta: { progressToken: randomUUID(), disposition: 'json' }
    })) as ToolResultContent
    const decoded = response.content.map((block) => ({ block, binary: binaryPayload(block) }))
    const binaries = decoded.flatMap(({ binary }) => (binary ? [binary] : []))
    const textContent = decoded.filter(({ binary }) => !binary).map(({ block }) => block)
    const outputPath = hasOutputOption ? (opts['output'] as string | undefined) : undefined
    // When the payload is piped through stdout, companion text (descriptions)
    // moves to stderr so the byte stream stays clean.
    const textStream = binaries.length && !outputPath && !process.stdout.isTTY ? process.stderr : process.stdout
    textContent.forEach((message, index, messages) => {
      const text = formatter(message, index, messages)
      textStream.write(`${text}\n`)
    })
    if (binaries.length) {
      await writeBinaryPayloads(binaries, outputPath)
    }
  })
}

/** Merge resolved silkweave `headers` over the caller's `requestInit.headers`. */
export function mergeRequestInit(requestInit?: RequestInit, headers?: Record<string, string>): RequestInit | undefined {
  if (!headers) {
    return requestInit
  }
  const merged = new Headers(requestInit?.headers)
  for (const [key, value] of Object.entries(headers)) {
    merged.set(key, value)
  }
  return { ...requestInit, headers: merged }
}

/** A short, legible message for a failed connect - auth failures called out explicitly. */
export function connectErrorMessage(error: unknown, url: URL): string {
  if (
    error instanceof UnauthorizedError ||
    (error instanceof StreamableHTTPError && (error.code === 401 || error.code === 403))
  ) {
    return `authentication failed for ${url.origin} - check your token`
  }
  return `cannot reach MCP server at ${url}: ${error instanceof Error ? error.message : String(error)}`
}

export const defaultFormatter: CLIFormatterFn = (message) => {
  if (message.type === 'text' && !message.text.includes('mcp://toolResult/')) {
    return `${message.text}`
  } else if (message.type === 'resource') {
    return parseResourceMessage(message)
  } else {
    return JSON.stringify(message)
  }
}

export const cliProxy: AdapterFactory<CliProxyOptions> = ({
  url,
  formatter = defaultFormatter,
  headers,
  requestInit,
  fetch: fetchImpl,
  authProvider
}) => {
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
        const resolvedHeaders = typeof headers === 'function' ? await headers() : headers
        const transport = new StreamableHTTPClientTransport(url, {
          requestInit: mergeRequestInit(requestInit, resolvedHeaders),
          fetch: fetchImpl,
          authProvider
        })
        const argv = process.argv.slice(2)
        let connected = false
        let tools: Tool[] = []
        try {
          await client.connect(transport)
          connected = true
          tools = (await client.listTools()).tools
        } catch (error) {
          // Root --help/--version (or a bare invocation) should not require a
          // live authenticated server - degrade to the base program with a
          // note. Anything else needs the remote tools, so fail legibly.
          const helpLike = argv.length === 0 || ['-h', '--help', '-V', '--version'].includes(argv[0])
          if (!helpLike) {
            console.error(connectErrorMessage(error, url))
            process.exitCode = 1
            return
          }
          console.error(`(remote tools unavailable: ${connectErrorMessage(error, url)})`)
        }
        for (const tool of tools) {
          registerToolCommand(program, client, tool, formatter, options.name)
        }
        if (!connected && argv.length === 0) {
          // Offline with no args: no subcommands are registered, so commander
          // would exit silently - print the base help explicitly instead.
          program.outputHelp()
          process.exitCode = 1
          return
        }
        await program.parseAsync()
        if (connected) {
          await transport.close()
        }
      },
      stop: async () => {
        /* noop */
      }
    }
  }
}
