import { createAction } from '@silkweave/core'
import z from 'zod/v4'

interface User {
  id: string
  name: string
  active: boolean
}

const USERS: User[] = [
  { id: '1', name: 'Ada', active: true },
  { id: '2', name: 'Linus', active: false },
  { id: '3', name: 'Grace', active: true }
]

export const listUsers = createAction({
  name: 'list-users',
  kind: 'query',
  description: 'List users, optionally filtering to active ones',
  input: z.object({ activeOnly: z.boolean().optional() }),
  output: z.object({ users: z.array(z.object({ id: z.string(), name: z.string(), active: z.boolean() })) }),
  run: async ({ activeOnly }) => ({ users: activeOnly ? USERS.filter((u) => u.active) : USERS })
})

export const banUser = createAction({
  name: 'ban-user',
  description: 'Ban a user by id',
  input: z.object({ id: z.string(), reason: z.string().min(3) }),
  output: z.object({ banned: z.string(), reason: z.string() }),
  run: async ({ id, reason }) => ({ banned: id, reason })
})
