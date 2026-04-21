import { silkweave } from '@silkweave/core'
import { type InferTrpcRouter, trpc } from '@silkweave/trpc'
import { GreetAction } from './actions/GreetAction.js'
import { ListThingsAction } from './actions/ListThingsAction.js'

const server = silkweave({ name: 'silkweave', description: 'Silkweave', version: '1.0.0' })
  .adapter(trpc({ host: 'localhost', port: 8080 }))
  .action(GreetAction)
  .action(ListThingsAction)

export type AppRouter = InferTrpcRouter<typeof server>

await server.start()

console.log('tRPC server listening on http://localhost:8080/trpc/')
