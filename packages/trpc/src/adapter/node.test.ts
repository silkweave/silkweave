import { AuthInfo } from '@silkweave/auth'
import { createAction, silkweave, SilkweaveError } from '@silkweave/core'
import http, { type Server } from 'http'
import { type AddressInfo } from 'net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { z } from 'zod/v4'
import { trpcNode } from './node.js'

/** One action set, reporting whichever caller reached it. */
const WhoAmI = createAction({
  name: 'whoami',
  description: 'Report the authenticated caller',
  kind: 'query',
  input: z.object({}),
  run: async (_input, context) => {
    const auth = context.getOptional<AuthInfo>('auth')
    return { clientId: auth?.clientId ?? null }
  }
})

let server: Server
let port: number

beforeAll(async () => {
  const api = trpcNode({
    endpoint: '/trpc',
    // Cookie-shaped identity: what a same-origin SPA actually presents.
    authenticate: (req) => {
      const cookie = req.headers.cookie ?? ''
      const match = /session=([^;]+)/.exec(cookie)
      if (!match) { return null }
      if (match[1] === 'banned') { throw new SilkweaveError('banned', 'forbidden', 403) }
      return { token: match[1], clientId: `user-${match[1]}` }
    }
  })

  const app = silkweave({ name: 'test', description: 'test', version: '0.0.0' })
    .adapter(api.adapter)
    .action(WhoAmI)
  await app.start()

  // Mount on a server the host owns, alongside its own routes.
  server = http.createServer((req, res) => {
    if (req.url?.startsWith('/trpc')) { return api.handler(req, res) }
    res.statusCode = 200
    res.end('the app')
  })
  port = await new Promise<number>((resolve) => {
    server.listen(0, () => resolve((server.address() as AddressInfo).port))
  })
})

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())))

const call = (cookie?: string) => fetch(`http://127.0.0.1:${port}/trpc/whoami?input=${encodeURIComponent('{}')}`, {
  headers: cookie ? { cookie } : {}
})

describe('trpcNode', () => {
  it('serves procedures mounted on a host-owned server', async () => {
    const res = await call('session=abc')
    expect(res.status).toBe(200)
    const body = await res.json() as { result: { data: { clientId: string } } }
    expect(body.result.data.clientId).toBe('user-abc')
  })

  it('leaves the rest of the host server alone', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/anything-else`)
    expect(await res.text()).toBe('the app')
  })

  it('401s when the resolver declines and no bearer auth is configured', async () => {
    const res = await call()
    expect(res.status).toBe(401)
    // No OAuth discovery advertised on a cookie-only endpoint.
    expect(res.headers.get('www-authenticate')).toBeNull()
  })

  it('surfaces a thrown SilkweaveError as its status, not an opaque 500', async () => {
    const res = await call('session=banned')
    expect(res.status).toBe(403)
  })

  it('configures no CORS - the host owns its response headers', async () => {
    const res = await call('session=abc')
    expect(res.headers.get('access-control-allow-origin')).toBeNull()
  })
})

describe('trpcNode readiness', () => {
  it('answers 503 when the router failed to build', async () => {
    // A request arriving before start() resolves is normal on a server that
    // binds its port before wiring routes; a boot failure must 503, not hang.
    const broken = trpcNode({ endpoint: '/trpc' })
    const bogus = { name: 'bogus', description: 'invalid schema', input: 'not-a-schema', run: async () => ({}) }
    const app = silkweave({ name: 't', description: 't', version: '0.0.0' })
      .adapter(broken.adapter)
      .action(bogus as unknown as typeof WhoAmI)
    await app.start().catch(() => { /* expected: the router cannot be built */ })

    const srv = http.createServer((req, res) => broken.handler(req, res))
    const p = await new Promise<number>((resolve) => {
      srv.listen(0, () => resolve((srv.address() as AddressInfo).port))
    })
    const res = await fetch(`http://127.0.0.1:${p}/trpc/whoami`)
    expect(res.status).toBe(503)
    expect((await res.json() as { error: string }).error).toBe('not_ready')
    await new Promise<void>((resolve) => srv.close(() => resolve()))
  })
})
