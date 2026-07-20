import { emptyLockfile, LOCKFILE_NAME, type SkillLockfile } from '@silkweave/skills'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

/** Default install target - the Claude Code user-level skills directory. */
export function defaultTarget(): string {
  return join(homedir(), '.claude', 'skills')
}

export async function readLockfile(target: string): Promise<SkillLockfile> {
  try {
    const raw = JSON.parse(await readFile(join(target, LOCKFILE_NAME), 'utf-8')) as SkillLockfile
    if (raw.lockfileVersion !== 1 || typeof raw.skills !== 'object') {
      throw new Error(`Unsupported lockfile at ${join(target, LOCKFILE_NAME)}`)
    }
    return raw
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') { return emptyLockfile() }
    throw error
  }
}

export async function writeLockfile(target: string, lockfile: SkillLockfile): Promise<void> {
  await mkdir(target, { recursive: true })
  await writeFile(join(target, LOCKFILE_NAME), `${JSON.stringify(lockfile, null, 2)}\n`, 'utf-8')
}
