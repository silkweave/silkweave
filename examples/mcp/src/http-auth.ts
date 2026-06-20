import { AuthConfig } from '@silkweave/auth'
import { createAction, silkweave } from '@silkweave/core'
import { http } from '@silkweave/mcp'
import { randomUUID } from 'crypto'
import z from 'zod/v4'

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

const HelloAction = createAction({
  name: 'hello',
  description: 'Greet a person by name and return a friendly greeting message.',
  input: z.object({ name: z.string().describe('The name of the person to greet.') }),
  output: z.object({ message: z.string() }),
  run: async ({ name }) => ({ message: `Hello, ${name}!` })
})

async function main() {
  console.log(`Starting MCP HTTP server with auth (token: ${API_TOKEN})`)
  await silkweave({ name: 'silkweave-auth', description: 'Silkweave with Auth', version: '1.0.0' })
    .set('sessionId', randomUUID)
    .adapter(http({ host: 'localhost', port: 8080, allowedHosts: ['localhost'], auth }))
    .action(HelloAction)
    .start()
}

main()
