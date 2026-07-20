import { sha256, type SkillPayload } from '@silkweave/skills'
import { mkdtemp, readdir, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { installSkill } from './install.js'

async function payload(): Promise<SkillPayload> {
  const skillMd = '---\nname: demo\ndescription: Demo\n---\nBody\n'
  const script = 'echo hi\n'
  return {
    name: 'demo',
    description: 'Demo',
    digest: 'sha256:aggregate',
    files: [
      { path: 'SKILL.md', mimeType: 'text/markdown', digest: await sha256(skillMd), text: skillMd },
      { path: 'scripts/run.sh', mimeType: 'text/x-shellscript', digest: await sha256(script), text: script }
    ]
  }
}

describe('installSkill', () => {
  it('writes verified files under target/<name> and cleans up stale ones', async () => {
    const target = await mkdtemp(join(tmpdir(), 'silkweave-install-'))
    const data = await payload()
    await installSkill(target, data)
    expect(await readFile(join(target, 'demo', 'SKILL.md'), 'utf-8')).toContain('Demo')
    expect(await readFile(join(target, 'demo', 'scripts', 'run.sh'), 'utf-8')).toBe('echo hi\n')

    // A second install without the script removes the stale tracked file.
    const slim = { ...data, files: [data.files[0]] }
    await installSkill(target, slim, {
      digest: 'sha256:old',
      files: { 'SKILL.md': 'sha256:x', 'scripts/run.sh': 'sha256:y' }
    })
    expect(await readdir(join(target, 'demo', 'scripts'))).toEqual([])
  })

  it('rejects a digest mismatch before writing anything', async () => {
    const target = await mkdtemp(join(tmpdir(), 'silkweave-install-'))
    const data = await payload()
    data.files[1] = { ...data.files[1], text: 'echo tampered\n' }
    await expect(installSkill(target, data)).rejects.toThrow(/Digest mismatch/)
    await expect(readdir(join(target, 'demo'))).rejects.toThrow()
  })

  it('rejects traversal paths and hostile names', async () => {
    const target = await mkdtemp(join(tmpdir(), 'silkweave-install-'))
    const data = await payload()
    data.files[0] = { ...data.files[0], path: '../evil.md' }
    await expect(installSkill(target, data)).rejects.toThrow(/Unsafe skill file path/)
    await expect(installSkill(target, { ...await payload(), name: '../Evil' })).rejects.toThrow(/invalid name/)
  })
})
