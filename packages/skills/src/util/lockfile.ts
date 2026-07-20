import type { SkillManifestEntry } from './manifest.js'

/** Lockfile name, written into the install target directory by `silkweave skills sync`. */
export const LOCKFILE_NAME = '.silkweave-lock.json'

export interface SkillLockEntry {
  version?: string
  /** Aggregate digest of the installed skill - compared against the remote manifest. */
  digest: string
  /** Per-file digests keyed by skill-relative path, for integrity checks and precise cleanup. */
  files: Record<string, string>
  /** When set, `sync` never updates this skill (held at the pinned version). */
  pinned?: string
}

export interface SkillLockfile {
  lockfileVersion: 1
  /** The MCP endpoint these skills were installed from (one server per lockfile/target). */
  server?: string
  skills: Record<string, SkillLockEntry>
}

export function emptyLockfile(server?: string): SkillLockfile {
  return { lockfileVersion: 1, ...(server ? { server } : {}), skills: {} }
}

export function lockEntry(entry: SkillManifestEntry, pinned?: string): SkillLockEntry {
  return {
    ...(entry.version ? { version: entry.version } : {}),
    digest: entry.digest,
    files: Object.fromEntries(entry.files.map((file) => [file.path, file.digest])),
    ...(pinned ? { pinned } : {})
  }
}

export type SkillStatus =
  /** Remote skill not installed yet. */
  | 'missing'
  /** Installed, remote content differs - `sync` updates it. */
  | 'outdated'
  /** Installed and identical to remote. */
  | 'up-to-date'
  /** Pinned locally while remote content differs - `sync` leaves it alone. */
  | 'held'
  /** Installed from this server previously, no longer offered - `sync --prune` removes it. */
  | 'orphaned'

export interface SkillDiff {
  name: string
  status: SkillStatus
  remote?: SkillManifestEntry
  locked?: SkillLockEntry
}

/** Diff a remote manifest against the local lockfile - the core of `sync`/`outdated`/`list`. */
export function diffSkills(manifest: SkillManifestEntry[], lockfile: SkillLockfile): SkillDiff[] {
  const remoteNames = new Set(manifest.map((entry) => entry.name))
  const diffs: SkillDiff[] = manifest.map((remote) => {
    const locked = lockfile.skills[remote.name]
    if (!locked) { return { name: remote.name, status: 'missing', remote } }
    if (locked.digest === remote.digest) { return { name: remote.name, status: 'up-to-date', remote, locked } }
    return { name: remote.name, status: locked.pinned ? 'held' : 'outdated', remote, locked }
  })
  for (const [name, locked] of Object.entries(lockfile.skills)) {
    if (!remoteNames.has(name)) { diffs.push({ name, status: 'orphaned', locked }) }
  }
  return diffs
}
