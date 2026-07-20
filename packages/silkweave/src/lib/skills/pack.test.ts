import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { packSkill } from './pack.js'

const SKILL_MD = `---
name: deploy-checklist
description: Walk the release checklist before deploying
metadata:
  version: "1.0.0"
---

# Deploy checklist
`

let root: string
let skillDir: string

/** A registry stub: 404 (unpublished), a published 1.0.0, or a network failure. */
const registry = (versions?: string[]) => (async () => {
  if (!versions) { throw new TypeError('fetch failed') }
  return versions.length
    ? new Response(JSON.stringify({ versions: Object.fromEntries(versions.map((v) => [v, {}])) }))
    : new Response('{}', { status: 404 })
}) as unknown as typeof fetch

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'silkweave-pack-'))
  skillDir = join(root, 'deploy-checklist')
  await mkdir(join(skillDir, 'references'), { recursive: true })
  await writeFile(join(skillDir, 'SKILL.md'), SKILL_MD)
  await writeFile(join(skillDir, 'references', 'steps.md'), '# Steps\n')
})

afterAll(() => rm(root, { recursive: true, force: true }))

describe('packSkill', () => {
  it('lays out a publishable plugin package', async () => {
    const out = join(root, 'out')
    const result = await packSkill({ dirs: [skillDir], out, fetch: registry([]) })
    expect(result).toMatchObject({ packageName: 'deploy-checklist-skill', version: '1.0.0', warnings: [] })

    const packageJson = JSON.parse(await readFile(join(out, 'package.json'), 'utf-8')) as Record<string, unknown>
    expect(packageJson).toMatchObject({ name: 'deploy-checklist-skill', version: '1.0.0' })
    const pluginJson = JSON.parse(await readFile(join(out, '.claude-plugin', 'plugin.json'), 'utf-8')) as Record<string, unknown>
    expect(pluginJson).toEqual({ name: 'deploy-checklist', version: '1.0.0', description: 'Walk the release checklist before deploying' })
    expect(await readFile(join(out, 'skills', 'deploy-checklist', 'SKILL.md'), 'utf-8')).toContain('Deploy checklist')
    expect(await readFile(join(out, 'skills', 'deploy-checklist', 'references', 'steps.md'), 'utf-8')).toBe('# Steps\n')
  })

  it('re-packs over its own previous output', async () => {
    const out = join(root, 'repack')
    await packSkill({ dirs: [skillDir], out, fetch: registry([]) })
    // A stale file from a previous layout must not survive the re-pack.
    await writeFile(join(out, 'skills', 'deploy-checklist', 'stale.md'), 'old\n')
    await packSkill({ dirs: [skillDir], out, fetch: registry([]) })
    await expect(readFile(join(out, 'skills', 'deploy-checklist', 'stale.md'), 'utf-8')).rejects.toThrow()
  })

  it('refuses to overwrite a directory that is not a pack output', async () => {
    const out = join(root, 'occupied')
    await mkdir(out, { recursive: true })
    await writeFile(join(out, 'precious.txt'), 'do not delete\n')
    await expect(packSkill({ dirs: [skillDir], out, fetch: registry([]) })).rejects.toThrow(/refusing to overwrite/)
    expect(await readFile(join(out, 'precious.txt'), 'utf-8')).toBe('do not delete\n')
  })

  it('refuses an already-published version unless forced', async () => {
    const out = join(root, 'published')
    await expect(packSkill({ dirs: [skillDir], out, fetch: registry(['1.0.0']) })).rejects.toThrow(/already published/)
    const forced = await packSkill({ dirs: [skillDir], out, fetch: registry(['1.0.0']), force: true })
    expect(forced.warnings[0]).toContain('already published')
  })

  it('warns but packs when the registry is unreachable', async () => {
    const out = join(root, 'offline')
    const result = await packSkill({ dirs: [skillDir], out, fetch: registry(undefined) })
    expect(result.warnings[0]).toContain('could not reach')
  })

  it('honors an explicit package name and rejects invalid ones', async () => {
    const out = join(root, 'named')
    const result = await packSkill({ dirs: [skillDir], out, packageName: '@atomic/skill-deploy', fetch: registry([]) })
    expect(result.packageName).toBe('@atomic/skill-deploy')
    await expect(packSkill({ dirs: [skillDir], out, packageName: 'Not Valid!', fetch: registry([]) })).rejects.toThrow(/not a valid npm package name/)
  })

  it('packs multiple skills into one multi-skill plugin', async () => {
    const secondDir = join(root, 'greet')
    await mkdir(secondDir, { recursive: true })
    await writeFile(join(secondDir, 'SKILL.md'), `---
name: greet
description: Greet politely
metadata:
  version: "1.0.0"
---
Body
`)
    const out = join(root, 'multi')
    // No --package: multi-skill packs cannot derive a name.
    await expect(packSkill({ dirs: [skillDir, secondDir], out, fetch: registry([]) })).rejects.toThrow(/--package/)

    const result = await packSkill({
      dirs: [skillDir, secondDir],
      out,
      packageName: '@atomic/example-plugin',
      fetch: registry([])
    })
    expect(result).toMatchObject({ packageName: '@atomic/example-plugin', version: '1.0.0' })
    const pluginJson = JSON.parse(await readFile(join(out, '.claude-plugin', 'plugin.json'), 'utf-8')) as Record<string, unknown>
    expect(pluginJson).toEqual({
      name: 'example-plugin',
      version: '1.0.0',
      description: 'Agent skills: deploy-checklist, greet'
    })
    expect(await readFile(join(out, 'skills', 'deploy-checklist', 'SKILL.md'), 'utf-8')).toContain('Deploy checklist')
    expect(await readFile(join(out, 'skills', 'greet', 'SKILL.md'), 'utf-8')).toContain('Greet politely')
  })
})
