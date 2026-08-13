import { defaultFormatter, registerToolCommand } from '@silkweave/mcp/cli-proxy'
import { Command } from 'commander'
import { connectRemote, parseUrl, type RemoteOptions } from './connect.js'

interface ProxyOptions extends RemoteOptions {
  silent: boolean
}

/**
 * `silkweave proxy <url> [command...]` - a universal cliProxy: connect to any
 * silkweave (or plain MCP Streamable HTTP) server, turn its tools into CLI
 * subcommands, and run one. The command tree is built from `tools/list` at
 * invocation time - exactly the `cliProxy` adapter, with the URL from argv
 * instead of a packaged binary. Positional arguments declared by the server
 * via `_meta['silkweave/args']` render as positionals here too.
 */
export function registerProxyCommand(program: Command): void {
  program
    .command('proxy')
    .description('Expose a remote MCP server as a CLI - its tools become subcommands')
    .passThroughOptions()
    .argument('<url>', 'MCP endpoint URL, e.g. https://host:8080/mcp')
    .argument('[command...]', 'remote tool command and its options (omit to list available commands)')
    .option('-t, --token <token>', 'bearer token (or SILKWEAVE_TOKEN)')
    .option('-H, --header <key=value...>', 'extra request header (repeatable)')
    .option('-s, --silent', 'suppress log messages', false)
    .action(async (urlValue: string, rest: string[], options: ProxyOptions) => {
      const url = parseUrl(urlValue)
      const { client, close } = await connectRemote(url, options)
      try {
        const info = client.getServerVersion()
        const serverName = info?.name ?? 'remote server'
        const inner = new Command()
          .name(`silkweave proxy ${url}`)
          .description(`${serverName}${info?.version ? ` v${info.version}` : ''} - proxied MCP tools`)
          .option('-s, --silent', 'suppress log messages', options.silent)
        for (const tool of (await client.listTools()).tools) {
          registerToolCommand(inner, client, tool, defaultFormatter, serverName)
        }
        if (!rest.length) {
          inner.outputHelp()
          return
        }
        await inner.parseAsync(rest, { from: 'user' })
      } finally {
        await close()
      }
    })
}
