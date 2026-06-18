import { Body, Controller, Get, NotFoundException, Param, Post, Query, UseGuards } from '@nestjs/common'
import { ApiOkResponse, ApiOperation, ApiParam, ApiProperty, ApiQuery } from '@nestjs/swagger'
import { Mcp, Trpc } from '@silkweave/nestjs'
import { IsBoolean, IsNumber, IsOptional, IsString, MinLength } from 'class-validator'
import { AdminGuard } from './admin.guard.js'

interface User { id: string; name: string; active: boolean }

const USERS: User[] = [
  { id: '1', name: 'Alice', active: true },
  { id: '2', name: 'Bob', active: false }
]

/**
 * A plain DTO carrying `@ApiProperty` + `class-validator` decorators. `@Mcp`/
 * `@Trpc` flatten its properties into the input schema - types, descriptions,
 * required/optional, and constraints (`MinLength`) all reflected.
 */
class BanUserDto {
  @ApiProperty({ description: 'Reason for the ban' })
  @IsString()
  @MinLength(3)
  reason!: string

  @ApiProperty({ description: 'Whether the ban is permanent', required: false })
  @IsOptional()
  @IsBoolean()
  permanent?: boolean
}

/**
 * Response DTO consumed by `@ApiOkResponse({ type: ... })`. `@Trpc` reflects it
 * into the generated procedure's precise output type (so `inferRouterOutputs`
 * yields this exact shape, not `unknown`).
 */
class UserDto {
  @ApiProperty() @IsString() id!: string
  @ApiProperty() @IsString() name!: string
  @ApiProperty() @IsBoolean() active!: boolean
}
class ListUsersResponse {
  @ApiProperty({ type: [UserDto] }) users!: UserDto[]
}
class UserResponse {
  @ApiProperty({ type: UserDto }) user!: UserDto
}
class BanResponse {
  @ApiProperty() @IsString() banned!: string
  @ApiProperty() @IsString() reason!: string
  @ApiProperty() @IsBoolean() permanent!: boolean
}

/** A streamed tick emitted by the `usersWatch` subscription. */
class WatchTick {
  @ApiProperty() @IsNumber() index!: number
  @ApiProperty() @IsNumber() activeUsers!: number
}

/**
 * An ordinary NestJS controller - it serves REST exactly as written. Adding
 * `@Mcp()` exposes a method as an MCP tool; adding `@Trpc()` exposes it as a
 * tRPC procedure. Both reflect the name/description/input from the route,
 * parameter decorators, and swagger/class-validator metadata; `@Trpc`
 * additionally reflects the output type from `@ApiOkResponse`.
 */
@Controller('users')
export class UsersController {
  @Get()
  @ApiOperation({ summary: 'List users' })
  @ApiQuery({ name: 'activeOnly', required: false, type: Boolean, description: 'Only return active users' })
  @ApiOkResponse({ type: ListUsersResponse })
  // `result: 'json'` returns compact JSON text instead of the default smart
  // formatter (a client can still override via `_meta.disposition`).
  @Mcp({ description: 'List users based on filters', result: 'json' })
  @Trpc() // → tRPC query `usersList`, output ListUsersResponse
  list(@Query('activeOnly') activeOnly?: boolean) {
    return { users: activeOnly ? USERS.filter((u) => u.active) : USERS }
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a single user by ID' })
  @ApiParam({ name: 'id', description: 'User ID' })
  @ApiOkResponse({ type: UserResponse })
  @Mcp()
  @Trpc() // → tRPC query `usersGet`
  get(@Param('id') id: string) {
    const user = USERS.find((u) => u.id === id)
    if (!user) { throw new NotFoundException('user not found') }
    return { user }
  }

  @Post(':id/ban')
  @ApiOperation({ summary: 'Ban a user' })
  @ApiParam({ name: 'id', description: 'User ID' })
  @ApiOkResponse({ type: BanResponse })
  @UseGuards(AdminGuard)
  @Mcp({ description: 'Ban a user (admin only - the AdminGuard checks the x-admin-token header on every transport, including MCP).' })
  @Trpc({ description: 'Ban a user (admin only).' }) // → tRPC mutation `usersBan`, guarded
  ban(@Param('id') id: string, @Body() body: BanUserDto) {
    return { banned: id, reason: body.reason, permanent: body.permanent ?? false }
  }

  // A verb-less `@Trpc({ kind: 'subscription' })` on an `async *` method: exposed
  // over tRPC (SSE) only, never as a public REST route. The `chunk` schema drives
  // the emitted `TRPCSubscriptionProcedure` output type.
  @ApiQuery({ name: 'ticks', required: false, type: Number, description: 'How many ticks to emit' })
  @Trpc({ kind: 'subscription', chunk: WatchTick }) // → tRPC subscription `usersWatch`
  async *watch(@Query('ticks') ticks = 3): AsyncGenerator<WatchTick, void, void> {
    for (let index = 0; index < ticks; index += 1) {
      yield { index, activeUsers: USERS.filter((u) => u.active).length }
    }
  }
}
