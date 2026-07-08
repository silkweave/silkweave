import { createAction, Logger, silkweave } from '@silkweave/core'
import { stdio } from '@silkweave/mcp'
import z from 'zod/v4'

const HelloAction = createAction({
  name: 'hello',
  description: 'Greet a person by name and return a friendly greeting message.',
  input: z.object({ name: z.string().describe('The name of the person to greet.') }),
  output: z.object({ message: z.string() }),
  run: async ({ name }, context) => {
    const logger = context.get<Logger>('logger')
    const message = `Hello, ${name}!`
    logger.info(message)
    return { message }
  }
})

const GenerateMessagesAction = createAction({
  name: 'generate-messages',
  description: 'Stream a series of generated messages about a topic',
  input: z.object({
    topic: z.string().describe('The subject the generated messages should be about.'),
    count: z.number().int().min(1).max(50).default(5).describe('How many messages to stream (1-50).'),
    delayMs: z.number().int().min(0).max(1000).default(50).describe('Delay between messages in milliseconds (0-1000).')
  }),
  chunk: z.object({ index: z.number().int(), text: z.string() }),
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
  await silkweave({ name: 'silkweave', description: 'Silkweave MCP stdio example', version: '1.0.0' })
    .adapter(stdio())
    .action(HelloAction)
    .action(GenerateMessagesAction)
    .start()
}

main()
