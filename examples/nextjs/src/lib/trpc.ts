import type { AppRouter } from '@/silkweave/server'
import { createTRPCClient, httpBatchLink } from '@trpc/client'

// Fully typed against the action set - `trpc.listUsers.query(...)` is inferred.
export const trpc = createTRPCClient<AppRouter>({
  links: [httpBatchLink({ url: '/api/trpc' })]
})
