import { silkweave } from '@silkweave/core'
import { typegen } from 'silkweave/typegen'
import { AdminAction } from './actions/AdminAction.js'
import { HelloAction } from './actions/HelloAction.js'
import { TaskAction } from './actions/TaskAction.js'

async function main() {
  await silkweave({ name: 'silkweave', description: 'Silkweave', version: '1.0.0' })
    .adapter(typegen({ path: 'resources/actions.d.ts' }))
    .action(HelloAction)
    .action(TaskAction)
    .action(AdminAction)
    .start()
}

main()
