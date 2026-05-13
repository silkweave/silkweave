import { SetMetadata } from '@nestjs/common'
import { ACTION_METADATA, type ActionMetadata } from '../lib/metadata.js'

/**
 * Method decorator that registers a Silkweave action.
 *
 * The decorated method becomes an Action and is exposed via every adapter
 * configured on `SilkweaveModule` (REST/tRPC/MCP), unless `transports` is
 * provided to restrict it.
 *
 * The method receives `(input, context)` where `input` is the parsed Zod input
 * and `context` is the `SilkweaveContext` (with `logger`, `request`, optional
 * `auth`). The class instance is a normal Nest provider, so other services can
 * be injected via the constructor.
 *
 * @example
 * ```ts
 * @Injectable()
 * @Actions('users')
 * export class UserActions {
 *   constructor(private db: DbService) {}
 *
 *   @Action({
 *     description: 'List users',
 *     input: z.object({ limit: z.number().optional() }),
 *     kind: 'query'
 *   })
 *   list(input: { limit?: number }, ctx: SilkweaveContext) {
 *     return this.db.listUsers(input.limit)
 *   }
 * }
 * ```
 */
export function Action<I extends object = object, O extends object = object>(
  options: ActionMetadata<I, O>
): MethodDecorator {
  return SetMetadata(ACTION_METADATA, options)
}
