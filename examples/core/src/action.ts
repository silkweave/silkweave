import { AuthInfo } from '@silkweave/auth'
import { createAction, createContext } from '@silkweave/core'
import { createLogger, Logger } from '@silkweave/logger'
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
  const auth: AuthInfo = {
    token: '38d6cc67-ed33-412b-9ab1-52f92b664f2b',
    clientId: '8315fd5b-d86c-4363-9bc1-95d007e00149',
    scopes: ['user'],
    expiresAt: 1779500000000
  }
  const response = await HelloAction.run({ name: 'world' }, createContext({ logger: createLogger(), auth }))
  console.info(response)
}

main()
