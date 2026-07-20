import { isResolvedSkill, isTextMimeType, SilkweaveError, type Skill, type SkillDefinition, type SkillFile } from '@silkweave/core'
import { sha256 } from './digest.js'
import { aggregateDigest } from './extension.js'
import { parseSkillMarkdown } from './frontmatter.js'
import { mimeForPath } from './mime.js'
import { assertSafeSkillPath } from './paths.js'

export const SKILL_MD = 'SKILL.md'

/** Spec pattern: lowercase alphanumerics with single inner hyphens, 1-64 chars. */
const SKILL_NAME_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/

interface RawSkillFiles {
  files: Record<string, Uint8Array | string>
  /** Basename of the source directory (spec: MUST equal the skill name), when loaded from disk. */
  dirName?: string
}

/**
 * Load a skill directory from disk. `node:fs` is imported lazily so the
 * package root stays importable on edge/Workers runtimes - a filesystem-less
 * runtime simply uses `defineSkill({ files })` and never reaches this branch.
 */
async function loadSkillDir(dir: string): Promise<RawSkillFiles> {
  const { readdir, readFile } = await import('node:fs/promises')
  const path = await import('node:path')
  const root = path.resolve(dir)
  const files: Record<string, Uint8Array | string> = {}
  const walk = async (current: string): Promise<void> => {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      if (entry.name.startsWith('.')) { continue }
      const absolute = path.join(current, entry.name)
      if (entry.isDirectory()) {
        await walk(absolute)
      } else if (entry.isFile()) {
        const relative = path.relative(root, absolute).split(path.sep).join('/')
        const bytes = new Uint8Array(await readFile(absolute))
        files[relative] = isTextMimeType(mimeForPath(relative)) ? new TextDecoder().decode(bytes) : bytes
      }
    }
  }
  await walk(root)
  return { files, dirName: path.basename(root) }
}

/** Conventional string entries under the frontmatter `metadata` mapping (`version`, `npmPackage`). */
function frontmatterMetadata(frontmatter: Record<string, unknown>, key: string): string | undefined {
  const metadata = frontmatter['metadata']
  if (typeof metadata !== 'object' || metadata === null) { return undefined }
  const value = (metadata as Record<string, unknown>)[key]
  return typeof value === 'string' ? value : undefined
}

/** SKILL.md first, then supporting files alphabetically - a stable order for digests and listings. */
function sortFiles(files: SkillFile[]): SkillFile[] {
  return [...files].sort((a, b) => {
    if (a.path === SKILL_MD) { return -1 }
    if (b.path === SKILL_MD) { return 1 }
    return a.path.localeCompare(b.path)
  })
}

/**
 * Resolve a `SkillDefinition` into a `Skill`: read the files (from `dir` or
 * inline), parse and validate the SKILL.md frontmatter against the Agent
 * Skills spec (name shape, directory-name match, description bounds), and
 * compute per-file + aggregate sha256 digests.
 */
export async function resolveSkill(definition: SkillDefinition): Promise<Skill> {
  if (!definition.dir === !definition.files) {
    throw new SilkweaveError('A skill definition requires exactly one of `dir` or `files`', 'invalid_skill')
  }
  const { files: rawFiles, dirName } = definition.dir
    ? await loadSkillDir(definition.dir)
    : { files: definition.files!, dirName: undefined }
  const skillMd = rawFiles[SKILL_MD]
  if (typeof skillMd !== 'string') {
    throw new SilkweaveError(`Skill${definition.dir ? ` at '${definition.dir}'` : ''} has no ${SKILL_MD}`, 'invalid_skill')
  }
  const { frontmatter } = parseSkillMarkdown(skillMd)
  const frontmatterName = typeof frontmatter['name'] === 'string' ? frontmatter['name'] : undefined
  const name = definition.name ?? frontmatterName ?? dirName
  if (!name || !SKILL_NAME_PATTERN.test(name) || name.length > 64) {
    throw new SilkweaveError(
      `Invalid skill name '${name ?? ''}' - expected 1-64 lowercase alphanumerics/hyphens (agentskills.io spec)`,
      'invalid_skill'
    )
  }
  // The spec requires the frontmatter name to equal the directory name. An
  // explicit `defineSkill({ name })` is the deliberate escape hatch (e.g. a
  // versioned checkout directory); a silent mismatch is a misconfiguration.
  if (!definition.name && dirName && frontmatterName && frontmatterName !== dirName) {
    throw new SilkweaveError(
      `Skill name '${frontmatterName}' does not match its directory '${dirName}' - rename one, or set defineSkill({ name }) explicitly`,
      'invalid_skill'
    )
  }
  const description = frontmatter['description']
  if (typeof description !== 'string' || description.length < 1 || description.length > 1024) {
    throw new SilkweaveError(`Skill '${name}': frontmatter 'description' is required (1-1024 chars)`, 'invalid_skill')
  }
  const files = sortFiles(await Promise.all(Object.entries(rawFiles).map(async ([path, data]) => ({
    path: assertSafeSkillPath(path),
    mimeType: mimeForPath(path),
    data,
    digest: await sha256(data)
  }))))
  const digest = await aggregateDigest(files)
  const version = definition.version ?? frontmatterMetadata(frontmatter, 'version')
  const npmPackage = definition.npmPackage ?? frontmatterMetadata(frontmatter, 'npmPackage')
  return {
    name,
    description,
    ...(version ? { version } : {}),
    ...(definition.tags?.length ? { tags: definition.tags } : {}),
    ...(npmPackage ? { npmPackage } : {}),
    frontmatter,
    digest,
    files
  }
}

/**
 * Resolve a mixed list of definitions and already-resolved skills, rejecting
 * duplicate names. This is what the MCP adapters call once at start.
 */
export async function resolveSkills(entries: (Skill | SkillDefinition)[]): Promise<Skill[]> {
  const skills = await Promise.all(entries.map((entry) => isResolvedSkill(entry) ? Promise.resolve(entry) : resolveSkill(entry)))
  const seen = new Set<string>()
  for (const skill of skills) {
    if (seen.has(skill.name)) {
      throw new SilkweaveError(`Duplicate skill name '${skill.name}'`, 'invalid_skill')
    }
    seen.add(skill.name)
  }
  return skills
}
