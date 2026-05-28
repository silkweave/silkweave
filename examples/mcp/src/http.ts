import { createAction, silkweave } from '@silkweave/core'
import { Logger } from '@silkweave/logger'
import { http } from '@silkweave/mcp'
import { randomUUID } from 'crypto'
import z from 'zod/v4'

const HelloAction = createAction({
  name: 'hello',
  description: 'Say hello',
  input: z.object({ name: z.string() }),
  output: z.object({ message: z.string() }),
  run: async ({ name }, context) => {
    const logger = context.get<Logger>('logger')
    const message = `Hello, ${name}!`
    logger.info(message)
    return { message }
  }
})

async function main() {
  await silkweave({ name: 'silkweave', description: 'Silkweave MCP HTTP example', version: '1.0.0' })
    .set('sessionId', randomUUID)
    .adapter(http({ host: 'localhost', port: 8080, allowedHosts: ['localhost'] }))
    .action(HelloAction)
    .start()
}

main()
