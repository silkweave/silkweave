import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { Action, AdapterFactory, handleToolError, SilkweaveContext, toolResponse } from '@silkweave/core'
import { createLogger } from '@silkweave/logger'
import { capitalCase, pascalCase } from 'change-case'

function registerTools(server: McpServer, actions: Action[], context: SilkweaveContext) {
  for (const action of actions) {
    server.registerTool(pascalCase(action.name), {
      title: capitalCase(action.name),
      description: action.description,
      inputSchema: action.input
    }, async (input, extra) => {
      const logger = createLogger({
        stream: false,
        onLog: (level, data) => {
          extra.sendNotification({ method: 'notifications/message', params: { level, data } })
        },
        onProgress: ({ progress, total, message }) => {
          if (!extra._meta?.progressToken) { return }
          extra.sendNotification({
            method: 'notifications/progress',
            params: { progress, total, message, progressToken: extra._meta.progressToken }
          })
        }
      })
      return action.run(input, context.fork({ logger, extra }))
        .then((result) => toolResponse(result))
        .catch(handleToolError)
    })
  }
}

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
        registerTools(server, actions, context)
        const transport = new StdioServerTransport()
        await server.connect(transport)
      },
      stop: async () => {
        await server?.close()
      }
    }
  }
}
