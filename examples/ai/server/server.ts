import { anthropic } from '@ai-sdk/anthropic'
import { createChatAction } from '@silkweave/ai'
import { silkweave } from '@silkweave/core'
import { type InferTrpcRouter, trpc } from '@silkweave/trpc'
import { config } from 'dotenv'

config({ path: '.env' })

if (!process.env.ANTHROPIC_API_KEY) {
  console.error('ANTHROPIC_API_KEY is required. Set it in your environment and try again.')
  process.exit(1)
}

const ChatAction = createChatAction({
  model: anthropic('claude-haiku-4-5'),
  system: 'You are a helpful assistant. Be concise.'
})

const server = silkweave({
  name: 'silkweave-ai',
  description: 'Silkweave + Vercel AI SDK chat server',
  version: '1.0.0'
})
  .adapter(trpc({ host: 'localhost', port: 8081 }))
  .action(ChatAction)

export type AppRouter = InferTrpcRouter<typeof server>

await server.start()

console.log('Chat server listening on http://localhost:8081/trpc/')
