import { createAction } from '@silkweave/core'
import { Logger } from '@silkweave/logger'
import z from 'zod'

export const GreetAction = createAction({
  name: 'greet',
  description: 'Greet a user by name',
  input: z.object({
    name: z.string().describe('Name of the person to greet')
  }),
  run: async ({ name }, context) => {
    const logger = context.get<Logger>('logger')
    logger.info(`Greeting ${name}`)
    return { message: `Hello, ${name}! Welcome to Silkweave on Vercel.` }
  }
})
