// Example: Vercel/Next.js App Router route handler
// File would be at: app/api/mcp/route.ts in a Next.js project

import { silkweave } from '@silkweave/core'
import { vercel } from '@silkweave/vercel'
import { HelloAction } from './actions/HelloAction.js'
import { TaskAction } from './actions/TaskAction.js'

const { adapter, GET, POST, DELETE } = vercel()

await silkweave({ name: 'silkweave', description: 'Silkweave', version: '1.0.0' })
  .adapter(adapter)
  .action(HelloAction)
  .action(TaskAction)
  .start()

export { DELETE, GET, POST }
