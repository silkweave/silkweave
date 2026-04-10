import { silkweave } from '@silkweave/core'
import { stdio } from '@silkweave/mcp'
import { AdminAction } from './actions/AdminAction.js'
import { HelloAction } from './actions/HelloAction.js'
import { TaskAction } from './actions/TaskAction.js'
import { UserListAction } from './actions/UserListAction.js'

async function main() {
  await silkweave({ name: 'silkweave', description: 'Silkweave', version: '1.0.0' })
    .adapter(stdio())
    .action(HelloAction)
    .action(TaskAction)
    .action(AdminAction)
    .action(UserListAction)
    .start()
}

main()
