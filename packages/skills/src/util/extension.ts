import type { Skill } from '@silkweave/core'
import { sha256 } from './digest.js'

/**
 * SEP-2640 extension identifier, declared under `capabilities.extensions` and
 * checked by clients before calling the extension methods.
 *
 * EXPERIMENTAL: SEP-2640 is a draft on the MCP Extensions Track and still
 * churning (the `skill://index.json` design was replaced by these methods in
 * July 2026). Everything in this module tracks the draft and may change.
 */
export const SKILLS_EXTENSION_ID = 'io.modelcontextprotocol/skills'

export const SKILLS_LIST_METHOD = 'skills/list'
export const SKILLS_GET_METHOD = 'skills/get'

/** One file reference in a skill's listing entry: resource URI + content digest. */
export interface SkillEntryResource {
  uri: string
  digest: string
}

/**
 * The SEP-2640 listing entry: the skill's `SKILL.md` resource URI, the
 * verbatim frontmatter (parsed to JSON), and the per-file digest manifest that
 * binds host approval to content.
 */
export interface SkillEntryWire {
  uri: string
  frontmatter: Record<string, unknown>
  resources: SkillEntryResource[]
}

/** The `skill://<name>/SKILL.md` URI identifying a skill in listings. */
export function skillUri(skill: Skill): string {
  return `skill://${skill.name}/SKILL.md`
}

/** Build the SEP-2640 listing entry for a resolved skill. */
export function skillEntry(skill: Skill): SkillEntryWire {
  return {
    uri: skillUri(skill),
    frontmatter: skill.frontmatter,
    resources: skill.files.map((file) => ({
      uri: `skill://${skill.name}/${file.path}`,
      digest: file.digest
    }))
  }
}

/**
 * Aggregate digest over per-file digests - the skill's update-check identity.
 * Files are ordered canonically (SKILL.md first, then by path) inside, so the
 * server (over resolved files) and a client (over a foreign server's listing
 * entry) compute identical values from the same content.
 */
export async function aggregateDigest(files: { path: string; digest: string }[]): Promise<string> {
  const sorted = [...files].sort((a, b) => {
    if (a.path === 'SKILL.md') {
      return -1
    }
    if (b.path === 'SKILL.md') {
      return 1
    }
    return a.path.localeCompare(b.path)
  })
  return sha256(sorted.map((file) => `${file.path} ${file.digest}`).join('\n'))
}
