import { createAction, Logger, silkweave } from '@silkweave/core'
import { type InferTrpcRouter, trpc } from '@silkweave/trpc'
import z from 'zod/v4'

const THINGS = ['hammer', 'saw', 'wrench', 'screwdriver', 'drill']

const GreetAction = createAction({
  name: 'greet',
  description: 'Greet someone by name',
  input: z.object({ name: z.string() }),
  output: z.object({ message: z.string() }),
  run: async ({ name }, context) => {
    const logger = context.get<Logger>('logger')
    const message = `Hello, ${name}!`
    logger.info(message)
    return { message }
  }
})

const ListThingsAction = createAction({
  name: 'list-things',
  description: 'List available things, optionally filtered',
  kind: 'query',
  input: z.object({ contains: z.string().optional() }),
  output: z.object({ items: z.array(z.string()) }),
  run: async ({ contains }) => {
    const items = contains
      ? THINGS.filter((thing) => thing.toLowerCase().includes(contains.toLowerCase()))
      : THINGS
    return { items }
  }
})

const GenerateMessagesAction = createAction({
  name: 'generate-messages',
  description: 'Stream a series of generated messages about a topic',
  input: z.object({
    topic: z.string(),
    count: z.number().int().min(1).max(50).default(5),
    delayMs: z.number().int().min(0).max(1000).default(50)
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

const server = silkweave({ name: 'silkweave', description: 'Silkweave tRPC example', version: '1.0.0' })
  .adapter(trpc({ host: 'localhost', port: 8080 }))
  .action(GreetAction)
  .action(ListThingsAction)
  .action(GenerateMessagesAction)

export type AppRouter = InferTrpcRouter<typeof server>

await server.start()

console.log('tRPC server listening on http://localhost:8080/trpc/')
