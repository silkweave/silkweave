import { AuthInfo } from '@silkweave/auth'
import { createJsonStore, google } from '@silkweave/auth/oauth'
import { createAction, silkweave } from '@silkweave/core'
import { http } from '@silkweave/mcp/server'
import z from 'zod/v4'

const store = createJsonStore('store.json')

const auth = google({
  clientId: process.env.GOOGLE_CLIENT_ID!,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
  resourceUrl: 'http://localhost:8080',
  redirectUris: [
    'http://localhost:*',
    'http://127.0.0.1:*',
    'https://claude.ai/*',
    'https://app.mcpjam.com/*',
    'mcpjam://*'
  ],
  requiredScopes: ['openid', 'https://www.googleapis.com/auth/userinfo.email'],
  callbackPath: '/auth/callback',
  signingKey: 'c937130a-73d9-4c12-96bf-b12d70867685',
  store
})

const UserAction = createAction({
  name: 'user',
  description: 'Retrieve the current authenticated user',
  input: z.object({ state: z.string() }),
  output: z.object({
    success: z.boolean(),
    state: z.string(),
    auth: z.strictObject({
      token: z.string(),
      clientId: z.string().optional(),
      scopes: z.array(z.string()).optional(),
      expiresAt: z.number().optional()
    })
  }),
  run: async ({ state }, context) => {
    const authInfo = context.get<AuthInfo>('auth')
    return { success: true, state, auth: authInfo }
  }
})

async function main() {
  console.log('Starting MCP HTTP server with Google OAuth')
  await silkweave({ name: 'silkweave-oauth', description: 'Silkweave with Google OAuth', version: '1.0.0' })
    .adapter(http({ host: 'localhost', port: 8080, allowedHosts: ['localhost'], auth }))
    .action(UserAction)
    .start()
}

main()
