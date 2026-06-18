import { SetMetadata } from '@nestjs/common'
import { TRPC_METADATA, type TrpcMetadata } from '../lib/metadata.js'

/**
 * Method decorator that exposes a NestJS controller route as a **tRPC
 * procedure** - the sibling of `@Mcp`. Like `@Mcp` it is additive and reflects
 * the procedure's input from the method's own metadata (route + `@Param`/
 * `@Query`/`@Body` + swagger/class-validator), so a single method can carry both
 * `@Trpc()` and `@Mcp()` and `@UseGuards()`.
 *
 * Two things differ from MCP because tRPC consumers need them:
 * - **kind** - inferred from the route (`@Get` ⇒ query, others ⇒ mutation) or an
 *   `async *` body (⇒ subscription); override with `@Trpc({ kind })`.
 * - **output** - the generated `AppRouter` carries precise output types. Drive
 *   them with `@ApiOkResponse({ type: Dto })` reflection or `@Trpc({ output })`.
 *
 * `@Trpc()` works **without** an HTTP-verb decorator: with no `@Get`/`@Post` the
 * route is never mapped as REST, so `@Trpc({ kind })` exposes it over tRPC (and
 * `@Mcp` over MCP) while keeping it off the public REST surface.
 *
 * @example
 * ```ts
 * @Controller('users')
 * export class UsersController {
 *   @Get('list-by-space')
 *   @ApiOperation({ summary: 'List users in a space' })
 *   @ApiOkResponse({ type: ListUsersResponse })   // drives the output type
 *   @UseGuards(AuthGuard)
 *   @Trpc()                                        // → procedure `usersListBySpace` (query)
 *   @Mcp()                                         // → MCP tool `UsersListBySpace`
 *   listBySpace(@Query() q: ListBySpaceQuery, @Req() req: AppRequest) {
 *     return this.service.list(req.user, q.spaceId)
 *   }
 * }
 * ```
 */
export function Trpc(options: TrpcMetadata = {}): MethodDecorator {
  return SetMetadata(TRPC_METADATA, options)
}
