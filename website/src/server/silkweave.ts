import { silkweave } from '@silkweave/core'
import { type InferTrpcRouter, trpcFetch } from '@silkweave/trpc'
import { CalculateAction } from '../../actions/calculate.js'
import { GreetAction } from '../../actions/greet.js'

const { adapter, handler } = trpcFetch({ endpoint: '/api/trpc' })

export const server = silkweave({ name: 'silkweave', description: 'Silkweave', version: '1.0.0' })
  .adapter(adapter)
  .action(GreetAction)
  .action(CalculateAction)

export type AppRouter = InferTrpcRouter<typeof server>

export { handler }

await server.start()
