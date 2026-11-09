import { McpServer } from '@modelcontextprotocol/server'
import type { Action, OnToolCall, SilkweaveContext, SilkweaveOptions } from '@silkweave/core'
import { registerTools } from './registerTools.js'
import type { SkillServing } from './skills.js'

/**
 * Build one MCP server for one request (or one stdio connection): the given
 * (already filtered) actions as tools, plus the skill surface when visible.
 * Shared by the Node `mcpTransport()` and the Web-Standard `edge()` adapter -
 * express-free, exported from `@silkweave/mcp/tools`.
 */
export function createMcpServer(
  options: SilkweaveOptions,
  actions: Action[],
  context: SilkweaveContext,
  onToolCall?: OnToolCall,
  serving?: SkillServing
): McpServer {
  // Gate the whole skill surface (resources + instructions) on the skill
  // actions having survived the per-request filter - see SkillServing.visible.
  const skillsVisible = serving?.visible(actions) ?? false
  const server = new McpServer(
    {
      name: options.name,
      description: options.description,
      version: options.version
    },
    {
      capabilities: { tools: {}, logging: {}, ...(skillsVisible ? { resources: {} } : {}) },
      ...(skillsVisible && serving ? { instructions: serving.instructions } : {})
    }
  )
  registerTools(server, actions, context, {
    onToolCall,
    serverInfo: { name: options.name, version: options.version }
  })
  if (skillsVisible) {
    serving?.register(server)
  }
  return server
}
