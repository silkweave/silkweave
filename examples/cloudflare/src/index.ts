// Silkweave MCP on Cloudflare Workers.
//
// - Web-Standard `edge()` adapter (no Express) maps straight onto a Worker's
//   `fetch` handler - it serves the MCP transport AND the full OAuth 2.1 surface
//   (/authorize, /token, /register, /auth/callback, both well-knowns).
// - Stateless transport (`sessionIdGenerator: undefined`, baked into `edge()`):
//   no `Mcp-Session-Id`, no session map. Every request is self-contained, so the
//   Worker scales horizontally with zero shared in-memory state.
// - OAuth state (auth codes, PKCE verifiers, client registrations, refresh tokens)
//   lives in Cloudflare KV. Workers have no filesystem, so the JSON-file store is
//   out; we reuse `createRedisStore` over a tiny KV adapter (KV's get/put/delete
//   matches its RedisClient shape).

import { createRedisStore, google, RedisClient } from '@silkweave/auth/oauth'
import { createAction, silkweave } from '@silkweave/core'
import { edge } from '@silkweave/edge'
import z from 'zod/v4'

// Minimal Cloudflare KV typing. In a real project use `@cloudflare/workers-types`
// (`wrangler types`) instead of hand-rolling these.
interface KVNamespace {
  get(key: string): Promise<string | null>
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>
  delete(key: string): Promise<void>
}

interface Env {
  OAUTH_KV: KVNamespace
  GOOGLE_CLIENT_ID: string
  GOOGLE_CLIENT_SECRET: string
  RESOURCE_URL: string
  SIGNING_KEY: string
}

// Cloudflare KV enforces a 60s minimum on `expirationTtl`; floor short-lived
// entries (e.g. a soon-to-expire auth code) so `put` never rejects.
const KV_MIN_TTL = 60

function kvClient(kv: KVNamespace): RedisClient {
  return {
    get: (key) => kv.get(key),
    set: async (key, value, options) => {
      const ttl = options?.ex
      await kv.put(key, value, ttl != null ? { expirationTtl: Math.max(KV_MIN_TTL, ttl) } : undefined)
    },
    del: (key) => kv.delete(key)
  }
}

const HelloAction = createAction({
  name: 'hello',
  description: 'Greet a person by name and return a friendly greeting message.',
  input: z.object({ name: z.string().describe('The name of the person to greet.') }),
  output: z.object({ message: z.string() }),
  run: async ({ name }) => ({ message: `Hello, ${name}!` })
})

const WhoAmIAction = createAction({
  name: 'who-am-i',
  description: 'Return the OAuth identity of the authenticated caller.',
  input: z.object({}),
  output: z.object({
    clientId: z.string().optional(),
    scopes: z.array(z.string()).optional()
  }),
  run: async (_input, context) => {
    const auth = context.get<{ clientId?: string; scopes?: string[] }>('auth')
    return { clientId: auth?.clientId, scopes: auth?.scopes }
  }
})

// KV + secrets arrive per-request on `env`, never at module load, so the Silkweave
// app is built lazily on the first request and memoized across warm invocations.
let app: ReturnType<typeof edge> | null = null

function getApp(env: Env): ReturnType<typeof edge> {
  if (app) {
    return app
  }

  const auth = google({
    clientId: env.GOOGLE_CLIENT_ID,
    clientSecret: env.GOOGLE_CLIENT_SECRET,
    resourceUrl: env.RESOURCE_URL,
    redirectUris: ['https://claude.ai/*', 'http://localhost:*', 'http://127.0.0.1:*'],
    requiredScopes: ['openid', 'https://www.googleapis.com/auth/userinfo.email'],
    callbackPath: '/auth/callback',
    signingKey: env.SIGNING_KEY,
    store: createRedisStore({ client: kvClient(env.OAUTH_KV) })
  })

  const instance = edge({ auth })

  void silkweave({ name: 'silkweave-cloudflare', description: 'Silkweave MCP on Cloudflare Workers', version: '1.0.0' })
    .adapter(instance.adapter)
    .action(HelloAction)
    .action(WhoAmIAction)
    .start()

  app = instance
  return instance
}

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    return getApp(env).handler(request)
  }
}
