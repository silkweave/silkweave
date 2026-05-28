import { createTRPCClient, httpSubscriptionLink, splitLink, httpBatchLink } from '@trpc/client'
import type { AppRouter } from '../server/server.js'

const url = '/trpc'

export const trpc = createTRPCClient<AppRouter>({
  links: [
    splitLink({
      condition: (op) => op.type === 'subscription',
      true: httpSubscriptionLink({ url }),
      false: httpBatchLink({ url })
    })
  ]
})
