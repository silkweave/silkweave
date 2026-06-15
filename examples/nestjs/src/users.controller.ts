import { Body, Controller, Get, NotFoundException, Param, Post, Query, UseGuards } from '@nestjs/common'
import { ApiOperation, ApiParam, ApiProperty, ApiQuery } from '@nestjs/swagger'
import { Mcp } from '@silkweave/nestjs'
import { IsBoolean, IsOptional, IsString, MinLength } from 'class-validator'
import { AdminGuard } from './admin.guard.js'

interface User { id: string; name: string; active: boolean }

const USERS: User[] = [
  { id: '1', name: 'Alice', active: true },
  { id: '2', name: 'Bob', active: false }
]

/**
 * A plain DTO carrying `@ApiProperty` + `class-validator` decorators. `@Mcp`
 * flattens its properties into the tool's input schema - types, descriptions,
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
 * An ordinary NestJS controller - it serves REST exactly as written. Adding
 * `@Mcp()` to a method additionally exposes it as an MCP tool, with the tool's
 * name/description/input reflected from the route, parameter decorators, and
 * swagger/class-validator metadata.
 */
@Controller('users')
export class UsersController {
  @Get()
  @ApiOperation({ summary: 'List users' })
  @ApiQuery({ name: 'activeOnly', required: false, type: Boolean, description: 'Only return active users' })
  @Mcp({ description: 'List users based on filters' })
  list(@Query('activeOnly') activeOnly?: boolean) {
    return { users: activeOnly ? USERS.filter((u) => u.active) : USERS }
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a single user by ID' })
  @ApiParam({ name: 'id', description: 'User ID' })
  @Mcp()
  get(@Param('id') id: string) {
    const user = USERS.find((u) => u.id === id)
    if (!user) { throw new NotFoundException('user not found') }
    return { user }
  }

  @Post(':id/ban')
  @ApiOperation({ summary: 'Ban a user' })
  @ApiParam({ name: 'id', description: 'User ID' })
  @UseGuards(AdminGuard)
  @Mcp({ description: 'Ban a user (admin only - the AdminGuard checks the x-admin-token header on every transport, including MCP).' })
  ban(@Param('id') id: string, @Body() body: BanUserDto) {
    return { banned: id, reason: body.reason, permanent: body.permanent ?? false }
  }
}
