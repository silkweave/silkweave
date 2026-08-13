import { createContext, type ActionRun } from '@silkweave/core'
import { describe, expect, it } from 'vitest'
import { skillActions } from './actions.js'
import type { SkillPayload } from './manifest.js'
import { resolveSkill } from './resolve.js'

const SKILL_MD = `---
name: demo-skill
description: A demo skill
---
Body
`

const context = createContext()

describe('skillActions', () => {
  it('lists skills and fetches payloads with digests', async () => {
    const skill = await resolveSkill({
      files: { 'SKILL.md': SKILL_MD, 'assets/logo.png': new Uint8Array([137, 80, 78, 71]) }
    })
    const [listSkills, getSkill] = skillActions([skill])

    const listing = await (listSkills.run as ActionRun<object, { skills: { name: string; digest: string }[] }>)(
      {},
      context
    )
    expect(listing.skills).toHaveLength(1)
    expect(listing.skills[0].name).toBe('demo-skill')
    expect(listing.skills[0].digest).toBe(skill.digest)

    const payload = await (getSkill.run as ActionRun<object, SkillPayload>)({ name: 'demo-skill' }, context)
    expect(payload.files.map((file) => file.path)).toEqual(['SKILL.md', 'assets/logo.png'])
    expect(payload.files[0].text).toContain('demo skill')
    expect(payload.files[1].base64).toBeDefined()

    await expect((getSkill.run as ActionRun<object, SkillPayload>)({ name: 'nope' }, context)).rejects.toThrow(
      /Unknown skill/
    )
  })
})
