import type { SilkweaveContext } from '@silkweave/core'
import type { Transport } from './metadata.js'

/**
 * Compile a `transports` allowlist + optional user `isEnabled` into a single
 * `(ctx) => boolean` callback compatible with `Action.isEnabled`.
 *
 * - If `transports` is omitted, the action runs on every adapter.
 * - If `transports` is set, the action is gated on `ctx.get<string>('adapter')`
 *   matching one of the listed transports. Each adapter in `@silkweave/nestjs`
 *   forks its context with `{ adapter: 'rest' | 'trpc' | 'mcp' }`.
 * - If both `transports` and `userIsEnabled` are set, they are AND-combined.
 */
export function buildIsEnabled(
  transports: Transport[] | undefined,
  userIsEnabled: ((ctx: SilkweaveContext) => boolean) | undefined
): ((ctx: SilkweaveContext) => boolean) | undefined {
  if (!transports && !userIsEnabled) { return undefined }
  return (ctx) => {
    if (transports) {
      const adapter = ctx.getOptional<string>('adapter')
      if (adapter && !transports.includes(adapter as Transport)) { return false }
    }
    return userIsEnabled ? userIsEnabled(ctx) : true
  }
}
