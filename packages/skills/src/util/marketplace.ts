import { SilkweaveError, type Skill } from '@silkweave/core'

/** Marketplace maintainer per the Claude Code marketplace schema (`name` required, `email` optional). */
export interface MarketplaceOwner {
  name: string
  email?: string
}

/** The npm plugin source shape - the only source kind we emit (relative paths break for URL-added marketplaces). */
export interface MarketplaceNpmSource {
  source: 'npm'
  package: string
  version?: string
  registry?: string
}

/** One plugin entry of the emitted marketplace document. */
export interface MarketplacePluginEntry {
  name: string
  source: MarketplaceNpmSource
  description: string
  version?: string
}

/** The `/.claude-plugin/marketplace.json` document consumed by `/plugin marketplace add`. */
export interface MarketplaceDocument {
  name: string
  owner: MarketplaceOwner
  description?: string
  plugins: MarketplacePluginEntry[]
}

/** Config for the marketplace document - what the adapters' `skillsMarketplace` option carries (resolved). */
export interface SkillsMarketplaceConfig {
  /** Marketplace identifier (kebab-case) - what users see in `/plugin install <plugin>@<name>`. */
  name: string
  owner: MarketplaceOwner
  description?: string
  /** Custom npm registry URL stamped onto every entry (private Verdaccio/GitHub registry). */
  registry?: string
}

/**
 * The Claude Code plugin name for an npm package: the basename with any scope
 * stripped (`@silkweave/example-plugin` -> `example-plugin`). Used for
 * multi-skill plugins, where no single skill name can name the plugin - and
 * `pluginFiles()` writes the same name into `plugin.json`, so the marketplace
 * entry and the installed plugin always agree.
 */
export function pluginNameForPackage(npmPackage: string): string {
  return npmPackage.split('/').pop()!
}

/** The version shared by every member of a plugin, or `undefined` when they disagree. */
function sharedVersion(skills: Skill[]): string | undefined {
  const version = skills[0].version
  return version && skills.every((skill) => skill.version === version) ? version : undefined
}

/** Derived description for a multi-skill plugin. */
function groupDescription(skills: Skill[]): string {
  return `Agent skills: ${skills.map((skill) => skill.name).join(', ')}`
}

/**
 * Build the Claude Code marketplace document for the npm-published skills in
 * a served set. Only skills carrying an `npmPackage` are listed - the content
 * is fetched from npm by Claude Code, never from this server, so the document
 * can be served unauthenticated without leaking anything that is not already
 * public. Skills sharing an `npmPackage` collapse into ONE plugin entry (a
 * multi-skill plugin, as packed by `silkweave skills pack <dir...>`), named
 * `pluginNameForPackage()`. Throws when no skill carries an `npmPackage`: an
 * empty marketplace is a misconfiguration, not a valid surface.
 */
export function marketplaceJson(skills: Skill[], config: SkillsMarketplaceConfig): MarketplaceDocument {
  const published = skills.filter((skill) => skill.npmPackage)
  if (!published.length) {
    throw new SilkweaveError(
      'skillsMarketplace requires at least one skill with an npmPackage (defineSkill({ npmPackage }) or frontmatter metadata.npmPackage)',
      'invalid_skill'
    )
  }
  const groups = new Map<string, Skill[]>()
  for (const skill of published) {
    groups.set(skill.npmPackage!, [...(groups.get(skill.npmPackage!) ?? []), skill])
  }
  return {
    name: config.name,
    owner: config.owner,
    ...(config.description ? { description: config.description } : {}),
    plugins: [...groups.entries()].map(([npmPackage, members]) => {
      const single = members.length === 1 ? members[0] : undefined
      const version = sharedVersion(members)
      return {
        name: single?.name ?? pluginNameForPackage(npmPackage),
        source: {
          source: 'npm',
          package: npmPackage,
          ...(version ? { version } : {}),
          ...(config.registry ? { registry: config.registry } : {})
        },
        description: single?.description ?? groupDescription(members),
        ...(version ? { version } : {})
      }
    })
  }
}

/** Options for `pluginFiles()` - the npm identity of the packed plugin. */
export interface PluginFilesOptions {
  /** npm package name the plugin publishes as. */
  npmPackage: string
  /** Description override for package.json + plugin.json (defaults to the skill's, or a derived listing for multi-skill plugins). */
  description?: string
}

/**
 * Lay out one or more skills as a skills-only Claude Code plugin package,
 * keyed by package-root-relative path: `package.json` (npm identity),
 * `.claude-plugin/plugin.json` (plugin manifest - skills are auto-discovered
 * from `skills/`), and each skill's files under `skills/<name>/`. Pure data -
 * the CLI's `skills pack` writes it to disk. Every skill needs a `version`
 * and a multi-skill plugin needs ONE agreed version (the plugin version is
 * what drives `/plugin update`). A multi-skill plugin is named
 * `pluginNameForPackage(npmPackage)` - the same name `marketplaceJson()`
 * emits for the grouped entry.
 */
export function pluginFiles(skills: Skill | Skill[], options: PluginFilesOptions): Record<string, Uint8Array | string> {
  const members = Array.isArray(skills) ? skills : [skills]
  for (const skill of members) {
    if (!skill.version) {
      throw new SilkweaveError(
        `Skill '${skill.name}' has no version - add \`metadata.version\` to its SKILL.md frontmatter (plugin versioning drives /plugin update)`,
        'invalid_skill'
      )
    }
  }
  const version = sharedVersion(members)
  if (!version) {
    throw new SilkweaveError(
      `Skills in one plugin must agree on a version - got ${members.map((skill) => `${skill.name}@${skill.version}`).join(', ')}`,
      'invalid_skill'
    )
  }
  const single = members.length === 1 ? members[0] : undefined
  const description = options.description ?? single?.description ?? groupDescription(members)
  const packageJson = {
    name: options.npmPackage,
    version,
    description,
    keywords: ['claude-code-plugin', 'agent-skills', ...members.map((skill) => skill.name)],
    files: ['.claude-plugin', 'skills']
  }
  const pluginJson = {
    name: single?.name ?? pluginNameForPackage(options.npmPackage),
    version,
    description
  }
  const files: Record<string, Uint8Array | string> = {
    'package.json': `${JSON.stringify(packageJson, null, 2)}\n`,
    '.claude-plugin/plugin.json': `${JSON.stringify(pluginJson, null, 2)}\n`
  }
  for (const skill of members) {
    for (const file of skill.files) {
      files[`skills/${skill.name}/${file.path}`] = file.data
    }
  }
  return files
}
