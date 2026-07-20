import { describe, expect, it } from 'vitest'
import { diffSkills, emptyLockfile, lockEntry } from './lockfile.js'
import type { SkillManifestEntry } from './manifest.js'

const entry = (name: string, digest: string, version?: string): SkillManifestEntry => ({
  name,
  description: 'test skill',
  ...(version ? { version } : {}),
  digest,
  files: [{ path: 'SKILL.md', mimeType: 'text/markdown', digest, size: 10 }]
})

describe('diffSkills', () => {
  it('classifies missing, outdated, up-to-date, held and orphaned', () => {
    const lockfile = emptyLockfile('https://example.com/mcp')
    lockfile.skills['current'] = lockEntry(entry('current', 'sha256:aa'))
    lockfile.skills['stale'] = lockEntry(entry('stale', 'sha256:old'))
    lockfile.skills['frozen'] = lockEntry(entry('frozen', 'sha256:old', '1.0.0'), '1.0.0')
    lockfile.skills['gone'] = lockEntry(entry('gone', 'sha256:aa'))

    const diffs = diffSkills([
      entry('current', 'sha256:aa'),
      entry('stale', 'sha256:new'),
      entry('frozen', 'sha256:new', '2.0.0'),
      entry('fresh', 'sha256:aa')
    ], lockfile)

    const byName = Object.fromEntries(diffs.map((diff) => [diff.name, diff.status]))
    expect(byName).toEqual({
      current: 'up-to-date',
      stale: 'outdated',
      frozen: 'held',
      fresh: 'missing',
      gone: 'orphaned'
    })
  })

  it('treats a pinned skill with identical content as up-to-date', () => {
    const lockfile = emptyLockfile()
    lockfile.skills['frozen'] = lockEntry(entry('frozen', 'sha256:aa', '1.0.0'), '1.0.0')
    expect(diffSkills([entry('frozen', 'sha256:aa', '1.0.0')], lockfile)[0].status).toBe('up-to-date')
  })
})
