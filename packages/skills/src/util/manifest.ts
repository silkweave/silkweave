import { bytesToBase64, isTextMimeType, type Skill } from '@silkweave/core'
import { fileBytes } from './digest.js'

/** One file in a skill's manifest listing - metadata only, no content. */
export interface SkillManifestFile {
  path: string
  mimeType: string
  digest: string
  /** Content size in bytes. Absent when the manifest was derived from a foreign SEP-2640 listing. */
  size?: number
}

/**
 * The listing entry for one skill - what `ListSkills` returns per skill and
 * what the CLI diffs against its lockfile. Mirrors SEP-2640's `skills/list`
 * entry shape (frontmatter identity + per-file digest manifest).
 */
export interface SkillManifestEntry {
  name: string
  description: string
  version?: string
  tags?: string[]
  /** Aggregate digest over the per-file digests - the skill's update-check identity. */
  digest: string
  files: SkillManifestFile[]
}

export function skillManifest(skills: Skill[]): SkillManifestEntry[] {
  return skills.map((skill) => ({
    name: skill.name,
    description: skill.description,
    ...(skill.version ? { version: skill.version } : {}),
    ...(skill.tags?.length ? { tags: skill.tags } : {}),
    digest: skill.digest,
    files: skill.files.map((file) => ({
      path: file.path,
      mimeType: file.mimeType,
      digest: file.digest,
      size: fileBytes(file.data).length
    }))
  }))
}

/** One file with content, as shipped by `GetSkill`: text mimes carry `text`, everything else `base64`. */
export interface SkillPayloadFile {
  path: string
  mimeType: string
  digest: string
  text?: string
  base64?: string
}

/** The full-content wire shape of one skill - what `GetSkill` returns and the CLI installs. */
export interface SkillPayload {
  name: string
  description: string
  version?: string
  digest: string
  files: SkillPayloadFile[]
}

export function skillPayload(skill: Skill): SkillPayload {
  return {
    name: skill.name,
    description: skill.description,
    ...(skill.version ? { version: skill.version } : {}),
    digest: skill.digest,
    files: skill.files.map((file) => ({
      path: file.path,
      mimeType: file.mimeType,
      digest: file.digest,
      ...(isTextMimeType(file.mimeType) && typeof file.data === 'string'
        ? { text: file.data }
        : { base64: bytesToBase64(fileBytes(file.data)) })
    }))
  }
}
