// One authorization server, N protected resources.
//
// Each tenant gets its own connector URL (`http://localhost:8080/<spaceId>`),
// its own RFC 9728 metadata document, and its own token audience - so a token
// minted for one tenant is rejected when replayed against another. There is
// still exactly one authorization server.
//
// Try it:
//   pnpm -F @silkweave/example-mcp http-multi-resource
//   curl -i http://localhost:8080/yoexoexl -X POST          # 401 + tenant challenge
//   curl http://localhost:8080/.well-known/oauth-protected-resource/yoexoexl
//   curl -i http://localhost:8080/.well-known/oauth-protected-resource/short     # 404
//
// Note the split of responsibilities. The resolver is *shape* mapping and is
// synchronous, so it serves a metadata document for any tenant-shaped path -
// including one that does not exist. Existence is the authorization server's
// job, asynchronously, in `allowedResources`: an unknown-but-shaped tenant gets
// a document but can never get a token (`invalid_target`). That leaks nothing
// beyond the id shape. For existence-accurate metadata, have the resolver
// consult a synchronous cache of live tenants.
import { AuthInfo, pathResolver } from '@silkweave/auth'
import { createJsonStore, google } from '@silkweave/auth/oauth'
import { createAction, silkweave } from '@silkweave/core'
import { http } from '@silkweave/mcp/server'
import z from 'zod/v4'

const AS = 'http://localhost:8080'
/** Tenant ids are 8 lowercase letters; anything else is not a resource. */
const TENANT = /^\/([a-z]{8})$/

/** Stand-in for a real tenant lookup (a store hit in production - cache it). */
const SPACES = new Set(['yoexoexl', 'kqwrmach'])

const store = createJsonStore('store.json')

const auth = google({
  clientId: process.env.GOOGLE_CLIENT_ID!,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
  // AS identity: iss, endpoint base, and the default audience. Stays a single
  // string - the authorization server does not fragment.
  resourceUrl: AS,
  // Resource-server side: map each request to the tenant resource it addresses.
  // pathResolver builds identifiers from the configured origin, never the
  // request's, so a spoofed Host cannot steer the metadata URL or the audience.
  // Non-tenant paths (sideload, /mcp) resolve to undefined and behave exactly as
  // an unset resourceUrl would.
  resolveResource: pathResolver({ origin: AS, match: TENANT }),
  // AS side: which resource indicators this server will mint an `aud` for.
  // The allow-list is the AS's, never the client's.
  allowedResources: (resource) => {
    const { origin, pathname } = new URL(resource)
    const match = TENANT.exec(pathname)
    return origin === AS && !!match && SPACES.has(match[1])
  },
  redirectUris: ['http://localhost:*', 'http://127.0.0.1:*', 'https://claude.ai/*'],
  requiredScopes: ['openid', 'https://www.googleapis.com/auth/userinfo.email'],
  callbackPath: '/auth/callback',
  signingKey: 'c937130a-73d9-4c12-96bf-b12d70867685',
  store
})

const WhoAmI = createAction({
  name: 'whoami',
  description: 'Report the authenticated user and the tenant this token is bound to',
  input: z.object({}),
  output: z.object({ email: z.string().optional(), audience: z.string().optional() }),
  run: async (_input, context) => {
    const authInfo = context.get<AuthInfo>('auth')
    // NOTE: `aud` says where this token may be *presented*, not what its subject
    // may *do* here. A real handler still checks membership of the tenant.
    return { email: authInfo.email as string | undefined, audience: authInfo.aud as string | undefined }
  }
})

async function main() {
  console.log('Starting multi-resource MCP server on', AS)
  console.log('Tenant connector URLs:', [...SPACES].map((id) => `${AS}/${id}`).join(', '))
  await silkweave({ name: 'silkweave-multi-resource', description: 'One AS, N protected resources', version: '1.0.0' })
    .adapter(
      http({
        host: 'localhost',
        port: 8080,
        allowedHosts: ['localhost'],
        auth,
        // Mount the transport at each tenant path as well as /mcp.
        transportPaths: ['/:spaceId']
      })
    )
    .action(WhoAmI)
    .start()
}

main()
