import { McpServer } from '@modelcontextprotocol/server'
import { serveStdio, type StdioServerHandle } from '@modelcontextprotocol/server/stdio'
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
  /** EXPERIMENTAL: also serve the SEP-2640 draft extension (`skills/list`/`skills/get` + capability). */
  skillsExtension?: boolean
}

export const stdio: AdapterFactory<StdioAdapterOptions | void> = (adapterOptions) => {
  return (options, baseContext) => {
    const context = baseContext.fork({ adapter: 'stdio' })
    let handle: StdioServerHandle | undefined
    return {
      context,
      start: async (actions) => {
        // Skills resolve async (file reads + digests), so they are prepared
        // here rather than in the generator - instructions are ctor-only.
        const serving = await prepareSkills(adapterOptions?.skills, { extension: adapterOptions?.skillsExtension })
        const all = serving ? [...actions, ...serving.actions] : actions
        all.forEach(validateActionDisposition)
        // serveStdio may call the factory more than once (a discarded
        // `server/discover` probe, then the connection), so build per call.
        const factory = () => {
          const server = new McpServer(
            {
              name: options.name,
              description: options.description,
              version: options.version
            },
            {
              capabilities: { tools: {}, logging: {}, ...(serving ? { resources: {} } : {}) },
              ...(serving ? { instructions: serving.instructions } : {})
            }
          )
          registerTools(server, all, context, { logStream: false, onToolCall: adapterOptions?.onToolCall })
          serving?.register(server)
          return server
        }
        // Build one instance eagerly so a registration error (e.g. two action
        // names colliding as the same PascalCase tool) rejects start() as it
        // did before, instead of surfacing on the first handshake as an
        // opaque internal error. serveStdio's factory is lazy.
        await factory().close()
        // `legacy: 'serve'`: 2025-era clients (the initialize handshake) keep
        // working next to 2026-07-28 clients. Errors go to stderr - stdout is
        // the protocol channel - since serveStdio reports only via onerror.
        handle = serveStdio(factory, {
          legacy: 'serve',
          onerror: (error) => console.error('MCP stdio error:', error)
        })
      },
      stop: async () => {
        await handle?.close()
      }
    }
  }
}
