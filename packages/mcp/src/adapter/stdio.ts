import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { AdapterFactory, validateActionDisposition } from '@silkweave/core'
import { registerTools } from '../handlers/registerTools.js'

export const stdio: AdapterFactory = () => {
  return (options, baseContext) => {
    const context = baseContext.fork({ adapter: 'stdio' })
    const server = new McpServer({
      name: options.name,
      description: options.description,
      version: options.version
    }, {
      capabilities: { tools: {}, logging: {} }
    })
    return {
      context,
      start: async (actions) => {
        actions.forEach(validateActionDisposition)
        registerTools(server, actions, context, { logStream: false })
        const transport = new StdioServerTransport()
        await server.connect(transport)
      },
      stop: async () => {
        await server?.close()
      }
    }
  }
}
