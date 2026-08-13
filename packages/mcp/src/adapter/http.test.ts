import { createContext, defineSkill } from '@silkweave/core'
import { type Server } from 'http'
import { type AddressInfo } from 'net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildMcpExpressApp } from './http.js'

const SKILL_MD = `---
name: deploy-checklist
description: Walk the release checklist before deploying
metadata:
  version: "1.0.0"
  npmPackage: deploy-checklist-skill
---

# Deploy checklist
`

let server: Server
let port: number

beforeAll(async () => {
  const app = buildMcpExpressApp(
    { name: 'team-skills', description: 'test', version: '0.0.0' },
    createContext({ adapter: 'http' }),
    [],
    {
      host: 'localhost',
      port: 0,
      // Bearer auth on everything else - the marketplace route must bypass it.
      auth: {
        verifyToken: async (token) => (token === 'secret' ? { token, clientId: 'test', scopes: [] } : undefined),
        required: true
      },
      skills: [defineSkill({ files: { 'SKILL.md': SKILL_MD } })],
      skillsMarketplace: { owner: { name: 'Atomic', email: 'dev@atomic.bi' }, description: 'Team skills' }
    }
  )
  await (app.locals.mcpReady as Promise<void>)
  server = app.listen(0)
  port = (server.address() as AddressInfo).port
})

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())))

describe('http skillsMarketplace', () => {
  it('serves the marketplace document unauthenticated', async () => {
    const response = await fetch(`http://127.0.0.1:${port}/.claude-plugin/marketplace.json`)
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('application/json')
    const doc = (await response.json()) as { name: string; owner: object; description: string; plugins: object[] }
    expect(doc.name).toBe('team-skills')
    expect(doc.owner).toEqual({ name: 'Atomic', email: 'dev@atomic.bi' })
    expect(doc.description).toBe('Team skills')
    expect(doc.plugins).toEqual([
      {
        name: 'deploy-checklist',
        source: { source: 'npm', package: 'deploy-checklist-skill', version: '1.0.0' },
        description: 'Walk the release checklist before deploying',
        version: '1.0.0'
      }
    ])
  })

  it('still guards the MCP endpoint', async () => {
    const response = await fetch(`http://127.0.0.1:${port}/mcp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' })
    })
    expect(response.status).toBe(401)
  })
})
