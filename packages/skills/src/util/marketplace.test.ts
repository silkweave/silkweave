import { describe, expect, it } from 'vitest'
import { marketplaceJson, pluginFiles } from './marketplace.js'
import { resolveSkill } from './resolve.js'

const SKILL_MD = `---
name: demo-skill
description: A demo skill
metadata:
  version: "1.2.0"
  npmPackage: demo-skill-skill
---
Body
`

const UNVERSIONED_MD = `---
name: bare-skill
description: A skill without version or package
---
Body
`

const owner = { name: 'Atomic', email: 'dev@atomic.bi' }

describe('marketplaceJson', () => {
  it('lists npm-published skills with pinned versions', async () => {
    const published = await resolveSkill({ files: { 'SKILL.md': SKILL_MD } })
    const unpublished = await resolveSkill({ files: { 'SKILL.md': UNVERSIONED_MD } })
    const doc = marketplaceJson([published, unpublished], { name: 'team-skills', owner })
    expect(doc).toEqual({
      name: 'team-skills',
      owner,
      plugins: [{
        name: 'demo-skill',
        source: { source: 'npm', package: 'demo-skill-skill', version: '1.2.0' },
        description: 'A demo skill',
        version: '1.2.0'
      }]
    })
  })

  it('honors defineSkill npmPackage over frontmatter and stamps the registry', async () => {
    const skill = await resolveSkill({ files: { 'SKILL.md': SKILL_MD }, npmPackage: '@atomic/skill-demo' })
    const doc = marketplaceJson([skill], { name: 'team-skills', owner, registry: 'https://npm.example.com' })
    expect(doc.plugins[0].source).toEqual({
      source: 'npm',
      package: '@atomic/skill-demo',
      version: '1.2.0',
      registry: 'https://npm.example.com'
    })
  })

  it('rejects a marketplace with no npm-published skill', async () => {
    const skill = await resolveSkill({ files: { 'SKILL.md': UNVERSIONED_MD } })
    expect(() => marketplaceJson([skill], { name: 'team-skills', owner })).toThrow(/npmPackage/)
  })

  it('groups skills sharing an npmPackage into one multi-skill plugin entry', async () => {
    const first = await resolveSkill({ files: { 'SKILL.md': SKILL_MD }, npmPackage: '@atomic/example-plugin' })
    const second = await resolveSkill({
      files: { 'SKILL.md': '---\nname: other-skill\ndescription: Another one\nmetadata:\n  version: "1.2.0"\n---\nBody\n' },
      npmPackage: '@atomic/example-plugin'
    })
    const doc = marketplaceJson([first, second], { name: 'team-skills', owner })
    expect(doc.plugins).toEqual([{
      name: 'example-plugin',
      source: { source: 'npm', package: '@atomic/example-plugin', version: '1.2.0' },
      description: 'Agent skills: demo-skill, other-skill',
      version: '1.2.0'
    }])
  })
})

describe('pluginFiles (multi-skill)', () => {
  it('lays out a multi-skill plugin named after the package', async () => {
    const first = await resolveSkill({ files: { 'SKILL.md': SKILL_MD } })
    const second = await resolveSkill({
      files: { 'SKILL.md': '---\nname: other-skill\ndescription: Another one\nmetadata:\n  version: "1.2.0"\n---\nBody\n' }
    })
    const files = pluginFiles([first, second], { npmPackage: '@atomic/example-plugin' })
    expect(JSON.parse(files['.claude-plugin/plugin.json'] as string)).toEqual({
      name: 'example-plugin',
      version: '1.2.0',
      description: 'Agent skills: demo-skill, other-skill'
    })
    expect(Object.keys(files)).toContain('skills/demo-skill/SKILL.md')
    expect(Object.keys(files)).toContain('skills/other-skill/SKILL.md')
  })

  it('rejects skills with mismatched versions in one plugin', async () => {
    const first = await resolveSkill({ files: { 'SKILL.md': SKILL_MD } })
    const second = await resolveSkill({
      files: { 'SKILL.md': '---\nname: other-skill\ndescription: Another one\nmetadata:\n  version: "2.0.0"\n---\nBody\n' }
    })
    expect(() => pluginFiles([first, second], { npmPackage: '@atomic/example-plugin' })).toThrow(/agree on a version/)
  })
})

describe('pluginFiles', () => {
  it('lays out a skills-only plugin package', async () => {
    const skill = await resolveSkill({
      files: { 'SKILL.md': SKILL_MD, 'references/steps.md': '# Steps\n' }
    })
    const files = pluginFiles(skill, { npmPackage: 'demo-skill-skill' })
    expect(Object.keys(files).sort()).toEqual([
      '.claude-plugin/plugin.json',
      'package.json',
      'skills/demo-skill/SKILL.md',
      'skills/demo-skill/references/steps.md'
    ])
    expect(JSON.parse(files['package.json'] as string)).toMatchObject({
      name: 'demo-skill-skill',
      version: '1.2.0',
      description: 'A demo skill',
      files: ['.claude-plugin', 'skills']
    })
    expect(JSON.parse(files['.claude-plugin/plugin.json'] as string)).toEqual({
      name: 'demo-skill',
      version: '1.2.0',
      description: 'A demo skill'
    })
    expect(files['skills/demo-skill/SKILL.md']).toContain('demo skill')
  })

  it('refuses to pack an unversioned skill', async () => {
    const skill = await resolveSkill({ files: { 'SKILL.md': UNVERSIONED_MD } })
    expect(() => pluginFiles(skill, { npmPackage: 'bare-skill-skill' })).toThrow(/metadata\.version/)
  })
})
