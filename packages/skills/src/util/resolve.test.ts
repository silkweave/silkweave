import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveSkill, resolveSkills } from './resolve.js'

const SKILL_MD = `---
name: commit-message
description: Write conventional commit messages for this repo
metadata:
  version: "1.2.0"
---

# Commit messages

Use conventional commits.
`

const files = (overrides: Record<string, Uint8Array | string> = {}) => ({
  'SKILL.md': SKILL_MD,
  'references/format.md': '# Format\n',
  ...overrides
})

describe('resolveSkill', () => {
  it('resolves inline files with frontmatter, digests and version', async () => {
    const skill = await resolveSkill({ files: files() })
    expect(skill.name).toBe('commit-message')
    expect(skill.description).toContain('conventional commit')
    expect(skill.version).toBe('1.2.0')
    expect(skill.files.map((file) => file.path)).toEqual(['SKILL.md', 'references/format.md'])
    expect(skill.files[0].digest).toMatch(/^sha256:[0-9a-f]{64}$/)
    expect(skill.digest).toMatch(/^sha256:[0-9a-f]{64}$/)
  })

  it('is digest-deterministic', async () => {
    const first = await resolveSkill({ files: files() })
    const second = await resolveSkill({ files: files() })
    expect(first.digest).toBe(second.digest)
  })

  it('changes the aggregate digest when any file changes', async () => {
    const first = await resolveSkill({ files: files() })
    const second = await resolveSkill({ files: files({ 'references/format.md': '# Changed\n' }) })
    expect(first.digest).not.toBe(second.digest)
  })

  it('prefers the definition version over frontmatter metadata', async () => {
    const skill = await resolveSkill({ files: files(), version: '2.0.0' })
    expect(skill.version).toBe('2.0.0')
  })

  it('rejects a missing SKILL.md', async () => {
    await expect(resolveSkill({ files: { 'notes.md': 'x' } })).rejects.toThrow(/no SKILL.md/)
  })

  it('rejects missing frontmatter', async () => {
    await expect(resolveSkill({ files: { 'SKILL.md': '# no frontmatter\n' } })).rejects.toThrow(/frontmatter/)
  })

  it('rejects an invalid name', async () => {
    const bad = SKILL_MD.replace('commit-message', 'Commit_Message')
    await expect(resolveSkill({ files: { 'SKILL.md': bad } })).rejects.toThrow(/Invalid skill name/)
  })

  it('rejects a missing description', async () => {
    await expect(resolveSkill({ files: { 'SKILL.md': '---\nname: x\n---\nbody' } })).rejects.toThrow(/description/)
  })

  it('rejects traversal paths in inline files', async () => {
    await expect(resolveSkill({ files: files({ '../evil.sh': 'rm -rf /' }) })).rejects.toThrow(/Unsafe skill file path/)
  })

  it('loads a skill from a directory and enforces the dir-name match', async () => {
    const root = await mkdtemp(join(tmpdir(), 'silkweave-skill-'))
    const dir = join(root, 'commit-message')
    await mkdir(join(dir, 'references'), { recursive: true })
    await writeFile(join(dir, 'SKILL.md'), SKILL_MD)
    await writeFile(join(dir, 'references', 'format.md'), '# Format\n')
    const skill = await resolveSkill({ dir })
    expect(skill.name).toBe('commit-message')
    expect(skill.files.map((file) => file.path)).toEqual(['SKILL.md', 'references/format.md'])

    const mismatched = join(root, 'other-name')
    await mkdir(mismatched, { recursive: true })
    await writeFile(join(mismatched, 'SKILL.md'), SKILL_MD)
    await expect(resolveSkill({ dir: mismatched })).rejects.toThrow(/does not match its directory/)
    // Explicit name is the escape hatch.
    const renamed = await resolveSkill({ dir: mismatched, name: 'commit-message' })
    expect(renamed.name).toBe('commit-message')
  })
})

describe('resolveSkills', () => {
  it('passes through resolved skills and rejects duplicates', async () => {
    const skill = await resolveSkill({ files: files() })
    const skills = await resolveSkills([skill, { files: { 'SKILL.md': SKILL_MD.replace('commit-message', 'other-skill') } }])
    expect(skills.map((entry) => entry.name)).toEqual(['commit-message', 'other-skill'])
    await expect(resolveSkills([skill, { files: files() }])).rejects.toThrow(/Duplicate skill name/)
  })
})
