// Example: Vercel/Next.js App Router route handler
// File would be at: app/api/mcp/route.ts in a Next.js project

import { createAction, silkweave } from '@silkweave/core'
import { vercel } from '@silkweave/vercel'
import z from 'zod/v4'

const HelloAction = createAction({
  name: 'hello',
  description: 'Say hello',
  input: z.object({ name: z.string() }),
  output: z.object({ message: z.string() }),
  run: async ({ name }) => ({ message: `Hello, ${name}!` })
})

const { adapter, GET, POST, DELETE } = vercel()

await silkweave({ name: 'silkweave', description: 'Silkweave Vercel example', version: '1.0.0' })
  .adapter(adapter)
  .action(HelloAction)
  .start()

export { DELETE, GET, POST }
