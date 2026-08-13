import { Client } from '@modelcontextprotocol/sdk/client'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { connectErrorMessage, mergeRequestInit } from '@silkweave/mcp/cli-proxy'

/** Common remote-connection options shared by `skills` and `proxy` commands. */
export interface RemoteOptions {
  token?: string
  header?: string[]
}

/**
 * Headers from `--token` / `--header` flags. A bare token gets the `Bearer `
 * prefix; a token that already carries a scheme (contains a space) is sent
 * verbatim. `--header` entries are `key=value` or `key: value`.
 */
export function remoteHeaders(options: RemoteOptions): Record<string, string> {
  const headers: Record<string, string> = {}
  const token = options.token ?? process.env['SILKWEAVE_TOKEN']
  if (token) {
    headers['authorization'] = token.includes(' ') ? token : `Bearer ${token}`
  }
  for (const entry of options.header ?? []) {
    const separator =
      entry.includes('=') && (!entry.includes(':') || entry.indexOf('=') < entry.indexOf(':')) ? '=' : ':'
    const index = entry.indexOf(separator)
    if (index < 1) {
      throw new Error(`Invalid --header '${entry}' - expected key=value`)
    }
    headers[entry.slice(0, index).trim().toLowerCase()] = entry.slice(index + 1).trim()
  }
  return headers
}

export interface RemoteConnection {
  client: Client
  close: () => Promise<void>
}

/**
 * Connect an MCP client to `url`. A failed connect prints a legible one-liner
 * (auth-specific on 401/403, mirroring cliProxy) and exits.
 */
export async function connectRemote(url: URL, options: RemoteOptions): Promise<RemoteConnection> {
  const client = new Client({ name: 'silkweave-cli', version: '0.0.0' })
  const transport = new StreamableHTTPClientTransport(url, {
    requestInit: mergeRequestInit(undefined, remoteHeaders(options))
  })
  try {
    await client.connect(transport)
  } catch (error) {
    console.error(connectErrorMessage(error, url))
    process.exit(1)
  }
  return { client, close: () => transport.close() }
}

/** Parse and normalize the `--url`/`<url>` argument. */
export function parseUrl(value: string): URL {
  try {
    return new URL(value)
  } catch {
    console.error(`Invalid MCP server URL: '${value}'`)
    process.exit(1)
  }
}
