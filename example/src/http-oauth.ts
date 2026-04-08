import { createJsonStore, google } from '@silkweave/auth'
import { silkweave } from '@silkweave/core'
import { http } from '@silkweave/mcp'
import { HelloAction } from './actions/HelloAction.js'
import { TaskAction } from './actions/TaskAction.js'
import { UserAction } from './actions/UserAction.js'

const store = createJsonStore('store.json')

const auth = google({
  clientId: process.env.GOOGLE_CLIENT_ID!,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
  resourceUrl: 'http://localhost:8080',
  redirectUris: ['http://localhost:*', 'http://127.0.0.1:*', 'https://claude.ai/*', 'https://app.mcpjam.com/*', 'mcpjam://*'],
  requiredScopes: ['openid', 'https://www.googleapis.com/auth/userinfo.email'],
  callbackPath: '/auth/callback',
  signingKey: 'c937130a-73d9-4c12-96bf-b12d70867685',
  store
})

async function main() {
  console.log('Starting MCP HTTP server with Google OAuth')
  await silkweave({ name: 'silkweave-oauth', description: 'Silkweave with Google OAuth', version: '1.0.0' })
    .adapter(http({ host: 'localhost', port: 8080, allowedHosts: ['localhost'], auth }))
    .action(HelloAction)
    .action(TaskAction)
    .action(UserAction)
    .start()
}

main()
