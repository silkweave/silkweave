import { SetMetadata } from '@nestjs/common'
import { ACTIONS_METADATA, type ActionsClassMetadata, type Transport } from '../lib/metadata.js'

/**
 * Class decorator that groups a provider's `@Action` methods under a common
 * prefix. The prefix is joined to each method's action name with a dot
 * (e.g. `@Actions('users')` + method `list` → action name `users.list`).
 *
 * The class itself remains a normal Nest provider - add `@Injectable()`
 * separately so it can be resolved by the DI container.
 *
 * Accepts either a prefix string (shorthand) or a full options object:
 * ```ts
 * @Actions('users')
 * @Actions({ prefix: 'users', transports: ['rest', 'trpc'] })
 * ```
 */
export function Actions(prefixOrOptions: string | ActionsClassMetadata = {}): ClassDecorator {
  const options: ActionsClassMetadata = typeof prefixOrOptions === 'string'
    ? { prefix: prefixOrOptions }
    : prefixOrOptions
  return SetMetadata(ACTIONS_METADATA, options)
}

export type { ActionsClassMetadata, Transport }
