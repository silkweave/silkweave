import { base64ToBytes, binary, createAction, Logger, resource, silkweave } from '@silkweave/core'
import { fastify } from '@silkweave/fastify'
import z from 'zod/v4'

// An 8x8 checkerboard PNG, pre-encoded so the example stays dependency-free.
const DEMO_PNG = base64ToBytes('iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAI0lEQVR42mNINvuYbPbx48vkjy+TkdkMOCUwhSBs3BJ0sAMAOwl44TYCiXQAAAAASUVORK5CYII=')

const RenderBadgeAction = createAction({
  name: 'render-badge',
  description: 'Render a small demo PNG badge and return it as a binary resource.',
  kind: 'query',
  input: z.object({ label: z.string().default('badge').describe('File name label for the rendered badge.') }),
  output: binary({ mimeType: 'image/png' }),
  run: async ({ label }) => resource(DEMO_PNG, {
    mimeType: 'image/png',
    name: `${label}.png`,
    description: `Demo badge '${label}' (8x8 PNG checkerboard)`
  })
})

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

const ListUsersAction = createAction({
  name: 'list.users',
  description: 'List users',
  kind: 'query',
  method: 'GET',
  path: 'spaces/:spaceId/users',
  queryParams: ['offset', 'limit'],
  input: z.object({
    spaceId: z.string(),
    offset: z.int().optional().default(0),
    limit: z.int().optional().default(10)
  }),
  output: z.object({
    users: z.array(z.object({ id: z.string() }))
  }),
  run: async ({ spaceId }) => {
    const users = [{ id: `${spaceId}.user` }]
    return { users }
  }
})

async function main() {
  await silkweave({ name: 'silkweave', description: 'Silkweave Fastify example', version: '1.0.0' })
    .adapter(fastify({ host: 'localhost', port: 8080, logger: true }))
    .action(HelloAction)
    .action(GenerateMessagesAction)
    .action(ListUsersAction)
    .action(RenderBadgeAction)
    .start()
}

main()
