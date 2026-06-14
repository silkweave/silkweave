import { Injectable, NotFoundException, UseGuards } from '@nestjs/common'
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

const CountdownInput = z.object({
  from: z.number().int()
})

const CountdownChunk = z.object({
  n: z.number().int()
})

@Injectable()
@Actions('users')
export class UserActions {
  @Action({
    description: 'List users',
    input: ListUsersInput,
    kind: 'query',
    queryParams: ['activeOnly']
  })
  list(input: z.infer<typeof ListUsersInput>, _ctx: SilkweaveContext) {
    const users = input.activeOnly ? USERS.filter((u) => u.active) : USERS
    return { users }
  }

  @Action({
    description: 'Get a single user by ID',
    input: GetUserInput,
    kind: 'query',
    path: 'users/:id'
  })
  get(input: z.infer<typeof GetUserInput>, _ctx: SilkweaveContext) {
    const user = USERS.find((u) => u.id === input.id)
    if (!user) { throw new NotFoundException('user not found') }
    return { user }
  }

  @UseGuards(AdminGuard)
  @Action({
    description: 'Ban a user (admin only - guard checks `x-admin-token` header on every transport, including MCP)',
    input: BanUserInput
  })
  ban(input: z.infer<typeof BanUserInput>, _ctx: SilkweaveContext) {
    return { banned: input.id, reason: input.reason }
  }

  @Action({
    description: 'Stream a countdown',
    input: CountdownInput,
    chunk: CountdownChunk
  })
  async *countdown(input: z.infer<typeof CountdownInput>, _ctx: SilkweaveContext) {
    for (let n = input.from; n >= 0; n -= 1) {
      await new Promise((r) => setTimeout(r, 200))
      yield { n }
    }
  }
}
