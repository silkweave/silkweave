import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { Action, ActionRun, AdapterFactory, isStreamingAction, runStreamingAction, SilkweaveContext } from '@silkweave/core'
import { createLogger } from '@silkweave/logger'
import { capitalCase, pascalCase } from 'change-case'
import { handleToolError, smartToolResult } from '../util/result.js'

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
      const actionContext = context.fork({ logger, extra })
      const progressToken = extra._meta?.progressToken
      try {
        let result: object | object[]
        if (isStreamingAction(action)) {
          result = await runStreamingAction(action, input, actionContext, progressToken
            ? async (chunk, index) => {
              await extra.sendNotification({
                method: 'notifications/progress',
                params: { progressToken, progress: index + 1, message: JSON.stringify(chunk) }
              })
            }
            : undefined)
        } else {
          result = await (action.run as ActionRun<object, object>)(input, actionContext)
        }
        return action.toolResult?.(result, actionContext) ?? smartToolResult(result)
      } catch (error) {
        return handleToolError(error)
      }
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
