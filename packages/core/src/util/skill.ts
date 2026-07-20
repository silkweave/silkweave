import { SilkweaveError } from './error.js'

/**
 * One file of a resolved skill. `data` is the literal text for text-based
 * media types (SKILL.md, references) and raw bytes for everything else;
 * `digest` is the SEP-2640-style content digest (`sha256:<hex>`) computed over
 * the UTF-8 bytes of the content.
 */
export interface SkillFile {
  /** Skill-root-relative path with `/` separators, e.g. `SKILL.md`, `references/api.md`. */
  path: string
  /** IANA media type derived from the file extension. */
  mimeType: string
  data: Uint8Array | string
  /** `sha256:<hex>` over the file's bytes. */
  digest: string
}

/**
 * A resolved Agent Skill (https://agentskills.io/specification): a validated
 * `SKILL.md` plus supporting files, with per-file digests. Produced by
 * `resolveSkills()` in `@silkweave/skills`; consumed by the MCP adapters'
 * `skills` option. This type lives in core - like `Action` - so adapters can
 * accept skills without a runtime dependency on `@silkweave/skills`.
 */
export interface Skill {
  /** Skill name per the spec: lowercase alphanumerics + single hyphens, <= 64 chars. */
  name: string
  /** The frontmatter `description` - what the skill does and when to use it. */
  description: string
  /**
   * Version for update tracking. The Agent Skills spec has no first-class
   * version field, so this is sourced from `defineSkill({ version })` or the
   * conventional `metadata.version` frontmatter entry.
   */
  version?: string
  /** Free-form grouping labels, matched by per-request skill/tool filters. */
  tags?: string[]
  /** The verbatim SKILL.md frontmatter, parsed to JSON. */
  frontmatter: Record<string, unknown>
  /** Aggregate digest over the sorted per-file digests - the skill's identity for update checks. */
  digest: string
  /** All files of the skill, `SKILL.md` first. */
  files: SkillFile[]
}

/**
 * An unresolved skill declaration - what `defineSkill()` returns and the MCP
 * adapters' `skills` option accepts. Exactly one of `dir` (loaded from the
 * filesystem at start) or `files` (inline content, for edge/Workers runtimes
 * without a filesystem) must be set.
 */
export interface SkillDefinition {
  /** Directory containing `SKILL.md` (absolute, or relative to the process cwd). */
  dir?: string
  /** Inline files keyed by skill-root-relative path. Must include `SKILL.md`. */
  files?: Record<string, Uint8Array | string>
  /**
   * Skill name override. Defaults to the frontmatter `name` (which the spec
   * requires to match the directory name).
   */
  name?: string
  /** Version override; wins over the frontmatter `metadata.version` convention. */
  version?: string
  /** Grouping labels carried onto the resolved skill. */
  tags?: string[]
}

/**
 * Declare a skill for the MCP adapters' `skills` option. Pure sync capture -
 * reading, parsing, and digesting happen in `resolveSkills()`
 * (`@silkweave/skills`) when the adapter starts.
 *
 * ```ts
 * silkweave({ name: 'team-skills' })
 *   .adapter(http({ port: 8080, skills: [defineSkill({ dir: './skills/deploy' })] }))
 * ```
 */
export function defineSkill(definition: SkillDefinition): SkillDefinition {
  if (!definition.dir === !definition.files) {
    throw new SilkweaveError('defineSkill() requires exactly one of `dir` or `files`', 'invalid_skill')
  }
  return definition
}

/** Whether a `skills` entry is already resolved (a `Skill`) vs a `SkillDefinition`. */
export function isResolvedSkill(value: Skill | SkillDefinition): value is Skill {
  return Array.isArray((value as Skill).files) && typeof (value as Skill).digest === 'string'
}
