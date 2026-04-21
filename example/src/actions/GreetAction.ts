import { createAction } from '@silkweave/core'
import { Logger } from '@silkweave/logger'
import z from 'zod'

export const GreetAction = createAction({
  name: 'greet',
  description: 'Greet someone by name',
  input: z.object({
    name: z.string().describe('The name of the person to greet')
  }),
  output: z.object({
    message: z.string()
  }),
  run: async ({ name }, context) => {
    const logger = context.get<Logger>('logger')
    const message = `Hello, ${name}!`
    logger.info(message)
    return { message }
  }
})
