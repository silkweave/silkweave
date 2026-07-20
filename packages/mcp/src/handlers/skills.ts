import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { SilkweaveError, type Action, type Skill, type SkillDefinition } from '@silkweave/core'

/**
 * The prepared skill-serving surface an MCP transport consumes: the
 * `ListSkills`/`GetSkill` actions to append to the tool list, the server
 * `instructions` blurb, and a registrar for the `skill://` file resources.
 */
export interface SkillServing {
  skills: Skill[]
  /** `ListSkills`/`GetSkill` - ordinary actions, so filters/auth/telemetry apply. */
  actions: Action[]
  /** Server `instructions` pointing hosts at the skills (the WG-validated activation pattern). */
  instructions: string
  /** Register every skill file as a `skill://<name>/<path>` resource on a server instance. */
  register: (server: McpServer) => void
  /**
   * Whether the skill surface should be visible for a request: true when every
   * skill action survived the per-request `filterActions` pass. Gating the
   * resources + instructions on the same predicate keeps a filter that hides
   * the skill tools from also leaking the files via `resources/read`.
   */
  visible: (active: Action[]) => boolean
}

/**
 * Resolve the adapters' `skills` option into a `SkillServing`. Lazy-imports
 * `@silkweave/skills` (an optional peer, like express for `/server`) so the
 * option costs nothing when unused. Called once at adapter start; the result
 * is reused across per-request server instances.
 */
export async function prepareSkills(entries?: (Skill | SkillDefinition)[]): Promise<SkillServing | undefined> {
  if (!entries?.length) { return undefined }
  let skillsModule: typeof import('@silkweave/skills')
  let mcpModule: typeof import('@silkweave/skills/mcp')
  try {
    skillsModule = await import('@silkweave/skills')
    mcpModule = await import('@silkweave/skills/mcp')
  } catch (_error) {
    throw new SilkweaveError(
      'The `skills` option requires @silkweave/skills - install it alongside this adapter',
      'missing_dependency'
    )
  }
  const skills = await skillsModule.resolveSkills(entries)
  const actions = skillsModule.skillActions(skills)
  return {
    skills,
    actions,
    instructions: skillsModule.skillInstructions(skills),
    register: (server) => mcpModule.registerSkillResources(server, skills),
    visible: (active) => actions.every((action) => active.includes(action))
  }
}
