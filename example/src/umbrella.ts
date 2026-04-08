import { cli } from 'silkweave/cli'
import { silkweave } from 'silkweave/core'
import { AdminAction } from './actions/AdminAction.js'
import { HelloAction } from './actions/HelloAction.js'
import { TaskAction } from './actions/TaskAction.js'

async function main() {
  await silkweave({ name: 'silkweave', description: 'Silkweave', version: '1.0.0' })
    .set('userId', 'toby')
    .set('role', 'admin')
    .adapter(cli())
    .action(HelloAction)
    .action(TaskAction)
    .action(AdminAction)
    .start()
}

main()
