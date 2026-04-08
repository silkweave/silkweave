import { AuthConfig } from '@silkweave/auth'
import { silkweave } from '@silkweave/core'
import { http } from '@silkweave/mcp'
import { randomUUID } from 'crypto'
import { HelloAction } from './actions/HelloAction.js'
import { TaskAction } from './actions/TaskAction.js'

const API_TOKEN = process.env.API_TOKEN ?? 'test-token'

const auth: AuthConfig = {
  verifyToken: async (token) => {
    if (token === API_TOKEN) {
      return { token, clientId: 'example-client', scopes: ['read', 'write'] }
    }
    return undefined
  },
  resourceUrl: 'http://localhost:8080',
  authorizationServers: ['https://accounts.google.com']
}

async function main() {
  console.log(`Starting MCP HTTP server with auth (token: ${API_TOKEN})`)
  await silkweave({ name: 'silkweave-auth', description: 'Silkweave with Auth', version: '1.0.0' })
    .set('sessionId', randomUUID)
    .adapter(http({ host: 'localhost', port: 8080, allowedHosts: ['localhost'], auth }))
    .action(HelloAction)
    .action(TaskAction)
    .start()
}

main()
