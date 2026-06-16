import { defineSilkweave } from '@silkweave/nextjs'
import { banUser, listUsers } from './actions.js'

// Single source of truth: one action set, projected onto MCP + tRPC route files.
export const app = defineSilkweave({
  name: 'silkweave-nextjs',
  description: 'Silkweave Next.js example',
  version: '1.0.0',
  actions: [listUsers, banUser]
})

// Type-only export consumed by the typed tRPC client.
export type AppRouter = typeof app.Router
