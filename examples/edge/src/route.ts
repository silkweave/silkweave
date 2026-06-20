// Example: Web-Standard edge route handler (Vercel / Next.js App Router / any serverless runtime)
// File would be at: app/api/mcp/route.ts in a Next.js project

import { createAction, silkweave } from '@silkweave/core'
import { edge } from '@silkweave/edge'
import z from 'zod/v4'

const HelloAction = createAction({
  name: 'hello',
  description: 'Say hello',
  input: z.object({ name: z.string() }),
  output: z.object({ message: z.string() }),
  run: async ({ name }) => ({ message: `Hello, ${name}!` })
})

const { adapter, GET, POST, DELETE } = edge()

await silkweave({ name: 'silkweave', description: 'Silkweave edge example', version: '1.0.0' })
  .adapter(adapter)
  .action(HelloAction)
  .start()

export { DELETE, GET, POST }
