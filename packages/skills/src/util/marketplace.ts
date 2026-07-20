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
 * Build the Claude Code marketplace document for the npm-published skills in
 * a served set. Only skills carrying an `npmPackage` are listed - the content
 * is fetched from npm by Claude Code, never from this server, so the document
 * can be served unauthenticated without leaking anything that is not already
 * public. Throws when no skill carries an `npmPackage`: an empty marketplace
 * is a misconfiguration, not a valid surface.
 */
export function marketplaceJson(skills: Skill[], config: SkillsMarketplaceConfig): MarketplaceDocument {
  const published = skills.filter((skill) => skill.npmPackage)
  if (!published.length) {
    throw new SilkweaveError(
      'skillsMarketplace requires at least one skill with an npmPackage (defineSkill({ npmPackage }) or frontmatter metadata.npmPackage)',
      'invalid_skill'
    )
  }
  return {
    name: config.name,
    owner: config.owner,
    ...(config.description ? { description: config.description } : {}),
    plugins: published.map((skill) => ({
      name: skill.name,
      source: {
        source: 'npm',
        package: skill.npmPackage!,
        ...(skill.version ? { version: skill.version } : {}),
        ...(config.registry ? { registry: config.registry } : {})
      },
      description: skill.description,
      ...(skill.version ? { version: skill.version } : {})
    }))
  }
}

/** Options for `pluginFiles()` - the npm identity of the packed plugin. */
export interface PluginFilesOptions {
  /** npm package name the plugin publishes as. */
  npmPackage: string
}

/**
 * Lay out one skill as a skills-only Claude Code plugin package, keyed by
 * package-root-relative path: `package.json` (npm identity),
 * `.claude-plugin/plugin.json` (plugin manifest - skills are auto-discovered
 * from `skills/`), and the skill files under `skills/<name>/`. Pure data - the
 * CLI's `skills pack` writes it to disk. Requires a skill `version` (the
 * plugin version is what drives `/plugin update`).
 */
export function pluginFiles(skill: Skill, options: PluginFilesOptions): Record<string, Uint8Array | string> {
  if (!skill.version) {
    throw new SilkweaveError(
      `Skill '${skill.name}' has no version - add \`metadata.version\` to its SKILL.md frontmatter (plugin versioning drives /plugin update)`,
      'invalid_skill'
    )
  }
  const packageJson = {
    name: options.npmPackage,
    version: skill.version,
    description: skill.description,
    keywords: ['claude-code-plugin', 'agent-skills', skill.name],
    files: ['.claude-plugin', 'skills']
  }
  const pluginJson = {
    name: skill.name,
    version: skill.version,
    description: skill.description
  }
  const files: Record<string, Uint8Array | string> = {
    'package.json': `${JSON.stringify(packageJson, null, 2)}\n`,
    '.claude-plugin/plugin.json': `${JSON.stringify(pluginJson, null, 2)}\n`
  }
  for (const file of skill.files) {
    files[`skills/${skill.name}/${file.path}`] = file.data
  }
  return files
}
