import { cli } from '@silkweave/cli'
import { createAction, silkweave } from '@silkweave/core'
import { Logger } from '@silkweave/logger'
import z from 'zod/v4'

const HelloAction = createAction({
  name: 'hello',
  description: 'Say hello',
  input: z.object({
    name: z.string(),
    type: z.enum(['cat', 'dog'])
  }),
  output: z.object({ message: z.string() }),
  args: ['name'],
  run: async ({ name, type }, context) => {
    const logger = context.get<Logger>('logger')
    const message = `Hello, ${name}, my ${type}`
    logger.info(message)
    return { message }
  }
})

const GenerateMessagesAction = createAction({
  name: 'generate-messages',
  description: 'Stream a series of generated messages about a topic',
  input: z.object({
    topic: z.string().describe('The topic to generate messages about'),
    count: z.number().int().min(1).max(50).default(5).describe('Number of messages to generate'),
    delayMs: z.number().int().min(0).max(1000).default(50).describe('Per-message delay in milliseconds')
  }),
  chunk: z.object({
    index: z.number().int(),
    text: z.string()
  }),
  run: async function* ({ topic, count, delayMs }) {
    for (let i = 0; i < count; i += 1) {
      if (delayMs > 0) {
        await new Promise<void>((resolve) => { setTimeout(resolve, delayMs) })
      }
      yield { index: i, text: `Message ${i + 1} about ${topic}` }
    }
  }
})

async function main() {
  await silkweave({ name: 'silkweave', description: 'Silkweave CLI example', version: '1.0.0' })
    .adapter(cli())
    .action(HelloAction)
    .action(GenerateMessagesAction)
    .start()
}

main()
