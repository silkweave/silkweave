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
  /**
   * The serialized `/.claude-plugin/marketplace.json` document, present when
   * the adapter's `skillsMarketplace` option is set. Served unauthenticated
   * (like `/.well-known/`): it lists only npm-published skills, whose content
   * Claude Code fetches from npm, never from this server.
   */
  marketplace?: string
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
export interface PrepareSkillsOptions {
  /**
   * EXPERIMENTAL: also serve the SEP-2640 draft extension - the
   * `capabilities.extensions["io.modelcontextprotocol/skills"]` declaration
   * plus the `skills/list`/`skills/get` methods. Off by default while the
   * draft churns; the resources/tools/instructions surfaces are unaffected.
   */
  extension?: boolean
  /** Marketplace document config, with the `name` default already resolved by the adapter. */
  marketplace?: SkillsMarketplaceOptions & { name: string }
}

/** Where Claude Code expects a marketplace document - `/plugin marketplace add <url>` points here. */
export const MARKETPLACE_PATH = '/.claude-plugin/marketplace.json'

/**
 * The adapters' `skillsMarketplace` option: serve a Claude Code plugin
 * marketplace at `/.claude-plugin/marketplace.json` listing every served
 * skill that carries an `npmPackage` (published via `silkweave skills pack`),
 * as npm-sourced skills-only plugins. Consumers run
 * `/plugin marketplace add https://<host>/.claude-plugin/marketplace.json`.
 * npm sources are the only kind emitted - a URL-added marketplace cannot
 * resolve relative paths, and this server never hands out the plugin content.
 */
export interface SkillsMarketplaceOptions {
  /** Marketplace identifier (kebab-case). Defaults to the silkweave server's `name`. */
  name?: string
  /** Marketplace maintainer shown by Claude Code (`name` required, `email` optional). */
  owner: { name: string; email?: string }
  description?: string
  /** Custom npm registry URL stamped onto every entry (private Verdaccio/GitHub registry). */
  registry?: string
}

export async function prepareSkills(
  entries?: (Skill | SkillDefinition)[],
  options: PrepareSkillsOptions = {}
): Promise<SkillServing | undefined> {
  if (!entries?.length) {
    if (options.marketplace) {
      throw new SilkweaveError(
        'skillsMarketplace requires the `skills` option - there is nothing to list',
        'invalid_skill'
      )
    }
    return undefined
  }
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
  const marketplace = options.marketplace
    ? `${JSON.stringify(skillsModule.marketplaceJson(skills, options.marketplace), null, 2)}\n`
    : undefined
  return {
    skills,
    actions,
    instructions: skillsModule.skillInstructions(skills),
    ...(marketplace ? { marketplace } : {}),
    register: (server) => {
      mcpModule.registerSkillResources(server, skills)
      if (options.extension) {
        mcpModule.registerSkillExtension(server, skills)
      }
    },
    visible: (active) => actions.every((action) => active.includes(action))
  }
}
