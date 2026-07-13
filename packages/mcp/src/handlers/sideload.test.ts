import express from 'express'
import { mkdtempSync, writeFileSync } from 'fs'
import { type Server } from 'http'
import { tmpdir } from 'os'
import { join } from 'path'
import { type AddressInfo } from 'net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { sideloadResource } from './sideload.js'

let server: Server
let port: number
let dir: string
let secretPath: string

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'sideload-'))
  // A valid sideloaded resource + its metadata sidecar.
  writeFileSync(join(dir, 'abc'), 'hello-body')
  writeFileSync(join(dir, 'abc.json'), JSON.stringify({ contentType: 'text/plain' }))
  // A secret outside the resource dir, with a .json sibling so a naive
  // traversal (which reads `${id}.json` first) would still find both files.
  secretPath = join(dir, '..', 'sideload-secret')
  writeFileSync(secretPath, 'TOP-SECRET')
  writeFileSync(`${secretPath}.json`, JSON.stringify({ contentType: 'text/plain' }))

  const app = express()
  app.get('/resource/:id', sideloadResource({ resourceDir: dir }))
  server = app.listen(0)
  port = (server.address() as AddressInfo).port
})

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())))

const get = (path: string) => fetch(`http://127.0.0.1:${port}${path}`)

describe('sideloadResource', () => {
  it('serves a contained resource', async () => {
    const res = await get('/resource/abc')
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('hello-body')
  })

  it('rejects encoded path traversal instead of reading outside resourceDir', async () => {
    // Express 5 decodes %2F, so :id would become ../sideload-secret.
    const res = await get('/resource/..%2Fsideload-secret')
    expect(res.status).toBe(400)
    expect(await res.text()).not.toContain('TOP-SECRET')
  })

  it('rejects a bare .. segment', async () => {
    const res = await get('/resource/..%2F..%2Fetc%2Fpasswd')
    expect(res.status).toBe(400)
  })
})
