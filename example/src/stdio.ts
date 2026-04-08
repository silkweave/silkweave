import { silkweave } from '@silkweave/core'
import { stdio } from '@silkweave/mcp'
import { HelloAction } from './actions/HelloAction.js'
import { TaskAction } from './actions/TaskAction.js'

async function main() {
  await silkweave({ name: 'silkweave', description: 'Silkweave', version: '1.0.0' })
    .adapter(stdio())
    .action(HelloAction)
    .action(TaskAction)
    .start()
}

main()
