import { base64ToBytes } from '@silkweave/core'
import { assertSafeSkillPath, sha256, type SkillLockEntry, type SkillPayload } from '@silkweave/skills'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

/** Spec skill-name shape - revalidated client-side so a hostile server can't pick the install directory. */
const SKILL_NAME_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/

function payloadBytes(file: { text?: string; base64?: string }): Uint8Array {
  if (file.text !== undefined) {
    return new TextEncoder().encode(file.text)
  }
  return base64ToBytes(file.base64 ?? '')
}

/**
 * Write one skill payload under `<target>/<name>/`, verifying every file
 * against its manifest digest before anything touches disk, and removing files
 * a previous install tracked that the new version no longer ships. The target
 * directory can never be escaped: the name and every path are revalidated
 * here, and digests come from the same `sha256` the server used.
 */
export async function installSkill(target: string, payload: SkillPayload, previous?: SkillLockEntry): Promise<void> {
  if (!SKILL_NAME_PATTERN.test(payload.name) || payload.name.length > 64) {
    throw new Error(`Refusing to install skill with invalid name '${payload.name}'`)
  }
  const files = await Promise.all(
    payload.files.map(async (file) => {
      const bytes = payloadBytes(file)
      const digest = await sha256(bytes)
      if (digest !== file.digest) {
        throw new Error(`Digest mismatch for ${payload.name}/${file.path} - expected ${file.digest}, got ${digest}`)
      }
      return { path: assertSafeSkillPath(file.path), bytes }
    })
  )
  const root = join(target, payload.name)
  for (const file of files) {
    const destination = join(root, file.path)
    await mkdir(dirname(destination), { recursive: true })
    await writeFile(destination, file.bytes)
  }
  // Clean up files the previous version tracked that no longer exist remotely.
  const current = new Set(files.map((file) => file.path))
  for (const stale of Object.keys(previous?.files ?? {})) {
    if (!current.has(stale)) {
      await rm(join(root, assertSafeSkillPath(stale)), { force: true })
    }
  }
}

/** Remove an installed skill directory (only ever called for lockfile-tracked skills). */
export async function removeSkill(target: string, name: string): Promise<void> {
  if (!SKILL_NAME_PATTERN.test(name)) {
    throw new Error(`Refusing to remove invalid skill name '${name}'`)
  }
  await rm(join(target, name), { recursive: true, force: true })
}
