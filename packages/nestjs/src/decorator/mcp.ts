import { SetMetadata } from '@nestjs/common'
import { MCP_METADATA, type McpMetadata } from '../lib/metadata.js'

/**
 * Method decorator that exposes an existing NestJS controller route as an MCP
 * tool. It is **additive** - the route keeps serving HTTP exactly as before;
 * `@Mcp()` just opts the method into MCP discovery.
 *
 * The tool's name, description, and input schema are reflected from the
 * method's own metadata:
 * - **fields** from the parameter decorators (`@Param`/`@Query`/`@Body`) - a
 *   `@Param('id')` becomes an `id` field; a whole-DTO `@Body() dto: CreateDto`
 *   is flattened to its properties,
 * - **types/constraints/descriptions** from `@nestjs/swagger`
 *   (`@ApiParam`/`@ApiQuery`/`@ApiProperty`/`@ApiOperation`) and, when present,
 *   `class-validator` decorators on the DTOs,
 * - optionally refined by an OpenAPI document passed to `SilkweaveModule`.
 *
 * On a tool call the input is split back into the method's positional arguments
 * and the method is invoked directly (with `@UseGuards` guards applied first).
 *
 * @example
 * ```ts
 * @Controller('sessions/:sessionId/channels')
 * export class ChannelsController {
 *   @Get(':channelId')
 *   @ApiOperation({ summary: 'Get a specific channel by ID' })
 *   @ApiParam({ name: 'sessionId', description: 'Session ID' })
 *   @ApiParam({ name: 'channelId', description: 'Channel ID' })
 *   @Mcp()
 *   findOne(@Param('sessionId') sessionId: string, @Param('channelId') channelId: string) {
 *     return this.service.get(sessionId, channelId)
 *   }
 * }
 * ```
 */
export function Mcp(options: McpMetadata = {}): MethodDecorator {
  return SetMetadata(MCP_METADATA, options)
}
