import { Injectable, UseGuards } from '@nestjs/common'
import { type SilkweaveContext } from '@silkweave/core'
import { Action, Actions } from '@silkweave/nestjs'
import z from 'zod/v4'
import { AdminGuard } from './admin.guard.js'

interface User { id: string; name: string; active: boolean }

const USERS: User[] = [
  { id: '1', name: 'Alice', active: true },
  { id: '2', name: 'Bob', active: false }
]

const ListUsersInput = z.object({
  activeOnly: z.boolean().optional()
})

const GetUserInput = z.object({
  id: z.string()
})

const BanUserInput = z.object({
  id: z.string(),
  reason: z.string()
})

@Injectable()
@Actions('users')
export class UserActions {
  @Action({
    description: 'List users',
    input: ListUsersInput,
    kind: 'query'
  })
  list(input: z.infer<typeof ListUsersInput>, _ctx: SilkweaveContext) {
    const users = input.activeOnly ? USERS.filter((u) => u.active) : USERS
    return { users }
  }

  @Action({
    description: 'Get a single user by ID',
    input: GetUserInput,
    kind: 'query'
  })
  get(input: z.infer<typeof GetUserInput>, _ctx: SilkweaveContext) {
    const user = USERS.find((u) => u.id === input.id)
    if (!user) { return { user: null } }
    return { user }
  }

  @UseGuards(AdminGuard)
  @Action({
    description: 'Ban a user (admin only - guard checks `x-admin-token` header)',
    input: BanUserInput,
    transports: ['rest', 'trpc']
  })
  ban(input: z.infer<typeof BanUserInput>, _ctx: SilkweaveContext) {
    return { banned: input.id, reason: input.reason }
  }
}
