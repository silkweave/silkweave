import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { AdapterFactory, OnToolCall, Skill, SkillDefinition, validateActionDisposition } from '@silkweave/core'
import { registerTools } from '../handlers/registerTools.js'
import { prepareSkills } from '../handlers/skills.js'

export interface StdioAdapterOptions {
  /** Telemetry hook invoked once per tool call (fire-and-forget). */
  onToolCall?: OnToolCall
  /**
   * Agent skills to serve: `skill://` file resources + `ListSkills`/`GetSkill`
   * tools + a server-instructions pointer. Requires `@silkweave/skills`
   * (optional peer); resolved once at start.
   */
  skills?: (Skill | SkillDefinition)[]
}

export const stdio: AdapterFactory<StdioAdapterOptions | void> = (adapterOptions) => {
  return (options, baseContext) => {
    const context = baseContext.fork({ adapter: 'stdio' })
    let server: McpServer | undefined
    return {
      context,
      start: async (actions) => {
        // Skills resolve async (file reads + digests), so the server is built
        // here rather than in the generator - its instructions are ctor-only.
        const serving = await prepareSkills(adapterOptions?.skills)
        server = new McpServer({
          name: options.name,
          description: options.description,
          version: options.version
        }, {
          capabilities: { tools: {}, logging: {}, ...(serving ? { resources: {} } : {}) },
          ...(serving ? { instructions: serving.instructions } : {})
        })
        const all = serving ? [...actions, ...serving.actions] : actions
        all.forEach(validateActionDisposition)
        registerTools(server, all, context, { logStream: false, onToolCall: adapterOptions?.onToolCall })
        serving?.register(server)
        const transport = new StdioServerTransport()
        await server.connect(transport)
      },
      stop: async () => {
        await server?.close()
      }
    }
  }
}
