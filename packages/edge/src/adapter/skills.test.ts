import { createContext, defineSkill, type Action } from '@silkweave/core'
import { describe, expect, it } from 'vitest'
import { z } from 'zod/v4'
import { edge, type EdgeAdapterOptions } from './edge.js'

const SKILL_MD = `---
name: deploy-checklist
description: Walk the release checklist before deploying
metadata:
  version: "1.0.0"
---

# Deploy checklist
`

const skills = [defineSkill({
  files: {
    'SKILL.md': SKILL_MD,
    'references/steps.md': '# Steps\n'
  }
})]

const hello: Action = {
  name: 'hello',
  description: 'test action',
  input: z.object({}),
  run: async () => ({ ok: true })
} as Action

async function startEdge(options: EdgeAdapterOptions = {}) {
  const app = edge({ enableJsonResponse: true, skills, ...options })
  const generated = app.adapter({ name: 'test', description: 'test', version: '0.0.0' }, createContext())
  await generated.start([hello])
  return app
}

function post(body: object, headers: Record<string, string> = {}) {
  return new Request('http://localhost/mcp', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...headers },
    body: JSON.stringify(body)
  })
}

const rpc = (method: string, params?: object) => ({ jsonrpc: '2.0', id: 1, method, ...(params ? { params } : {}) })

describe('edge skills serving', () => {
  it('appends ListSkills/GetSkill to the tool list', async () => {
    const app = await startEdge()
    const body = await (await app.handler(post(rpc('tools/list')))).json() as { result: { tools: { name: string }[] } }
    expect(body.result.tools.map((tool) => tool.name).sort()).toEqual(['GetSkill', 'Hello', 'ListSkills'])
  })

  it('announces the skills in the initialize instructions', async () => {
    const app = await startEdge()
    const body = await (await app.handler(post(rpc('initialize', {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'test-client', version: '0.0.0' }
    })))).json() as { result: { instructions?: string } }
    expect(body.result.instructions).toContain('deploy-checklist')
    expect(body.result.instructions).toContain('silkweave skills sync')
  })

  it('serves skill files as skill:// resources', async () => {
    const app = await startEdge()
    const listing = await (await app.handler(post(rpc('resources/list')))).json() as { result: { resources: { uri: string }[] } }
    expect(listing.result.resources.map((resource) => resource.uri).sort()).toEqual([
      'skill://deploy-checklist/SKILL.md',
      'skill://deploy-checklist/references/steps.md'
    ])
    const read = await (await app.handler(post(rpc('resources/read', { uri: 'skill://deploy-checklist/SKILL.md' })))).json() as {
      result: { contents: { text?: string; mimeType?: string }[] }
    }
    expect(read.result.contents[0].mimeType).toBe('text/markdown')
    expect(read.result.contents[0].text).toContain('release checklist')
  })

  it('returns the digest-carrying manifest and payload through the tools', async () => {
    const app = await startEdge()
    const listRes = await (await app.handler(post(rpc('tools/call', { name: 'ListSkills', arguments: {} })))).json() as {
      result: { content: { text: string }[] }
    }
    const manifest = JSON.parse(listRes.result.content[0].text) as { skills: { name: string; version?: string; digest: string }[] }
    expect(manifest.skills[0]).toMatchObject({ name: 'deploy-checklist', version: '1.0.0' })
    expect(manifest.skills[0].digest).toMatch(/^sha256:/)

    const getRes = await (await app.handler(post(rpc('tools/call', { name: 'GetSkill', arguments: { name: 'deploy-checklist' } })))).json() as {
      result: { content: { text: string }[] }
    }
    const payload = JSON.parse(getRes.result.content[0].text) as { files: { path: string; text?: string; digest: string }[] }
    expect(payload.files.map((file) => file.path)).toEqual(['SKILL.md', 'references/steps.md'])
    expect(payload.files[0].text).toContain('Deploy checklist')
  })

  it('hides resources and instructions when a filter drops the skill tools', async () => {
    const app = await startEdge({
      filterActions: (all, request) => request.headers['x-role'] === 'insider'
        ? all
        : all.filter((action) => !action.tags?.includes('silkweave/skills'))
    })
    const outsiderTools = await (await app.handler(post(rpc('tools/list')))).json() as { result: { tools: { name: string }[] } }
    expect(outsiderTools.result.tools.map((tool) => tool.name)).toEqual(['Hello'])
    const outsiderResources = await (await app.handler(post(rpc('resources/list')))).json() as { error?: object }
    // Without the skill surface the server declares no resources capability.
    expect(outsiderResources.error).toBeDefined()
    const insider = await (await app.handler(post(rpc('resources/list'), { 'x-role': 'insider' }))).json() as { result: { resources: { uri: string }[] } }
    expect(insider.result.resources).toHaveLength(2)
  })
})
