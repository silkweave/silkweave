import { silkweave } from '@silkweave/core'
import { http } from '@silkweave/mcp'
import { randomUUID } from 'crypto'
import { AdminAction } from './actions/AdminAction.js'
import { HelloAction } from './actions/HelloAction.js'
import { TaskAction } from './actions/TaskAction.js'

async function main() {
  await silkweave({ name: 'silkweave', description: 'Silkweave', version: '1.0.0' })
    .set('sessionId', randomUUID)
    .adapter(http({ host: 'localhost', port: 8080, allowedHosts: ['localhost'] }))
    .action(HelloAction)
    .action(TaskAction)
    .action(AdminAction)
    .start()
}

main()
