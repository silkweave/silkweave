import { silkweave } from '@silkweave/core'
import { fastify } from '@silkweave/fastify'
import { HelloAction } from './actions/HelloAction.js'
import { TaskAction } from './actions/TaskAction.js'

async function main() {
  await silkweave({ name: 'silkweave', description: 'Silkweave', version: '1.0.0' })
    .adapter(fastify({ host: 'localhost', port: 8080, logger: true }))
    .action(HelloAction)
    .action(TaskAction)
    .start()
}

main()
