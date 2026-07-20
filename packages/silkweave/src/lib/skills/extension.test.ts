import type { Client } from '@modelcontextprotocol/sdk/client'
import { sha256 } from '@silkweave/skills'
import { describe, expect, it } from 'vitest'
import { fetchExtensionSkills, hasSkillsExtension } from './extension.js'

const SKILL_MD = '---\nname: demo-skill\ndescription: A demo\nmetadata:\n  version: "2.0.0"\n---\nBody\n'

/** A minimal SEP-2640 server stub - only what fetchExtensionSkills touches. */
async function stubClient(): Promise<Client> {
  const digest = await sha256(SKILL_MD)
  const files: Record<string, string> = { 'skill://demo-skill/SKILL.md': SKILL_MD }
  return {
    getServerCapabilities: () => ({ extensions: { 'io.modelcontextprotocol/skills': { directoryRead: false } } }),
    request: async () => ({
      skills: [{
        uri: 'skill://demo-skill/SKILL.md',
        frontmatter: { name: 'demo-skill', description: 'A demo', metadata: { version: '2.0.0' } },
        resources: [{ uri: 'skill://demo-skill/SKILL.md', digest }]
      }]
    }),
    readResource: async ({ uri }: { uri: string }) => ({
      contents: [{ uri, mimeType: 'text/markdown', text: files[uri] }]
    })
  } as unknown as Client
}

describe('SEP-2640 extension consumption', () => {
  it('detects the capability', async () => {
    expect(hasSkillsExtension(await stubClient())).toBe(true)
    expect(hasSkillsExtension({ getServerCapabilities: () => ({}) } as unknown as Client)).toBe(false)
  })

  it('maps listing entries to the manifest model and fetches payloads via resources', async () => {
    const extension = await fetchExtensionSkills(await stubClient())
    expect(extension.manifest).toHaveLength(1)
    const entry = extension.manifest[0]
    expect(entry).toMatchObject({ name: 'demo-skill', description: 'A demo', version: '2.0.0' })
    expect(entry.files).toEqual([{ path: 'SKILL.md', mimeType: 'text/markdown', digest: await sha256(SKILL_MD) }])
    expect(entry.digest).toMatch(/^sha256:/)

    const payload = await extension.payload('demo-skill')
    expect(payload.digest).toBe(entry.digest)
    expect(payload.files[0].text).toBe(SKILL_MD)
    await expect(extension.payload('nope')).rejects.toThrow(/Unknown skill/)
  })
})
