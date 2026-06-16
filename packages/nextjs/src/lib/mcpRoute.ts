import { Action, silkweave, SilkweaveOptions } from '@silkweave/core'
import { vercel } from '@silkweave/vercel'
import { McpRouteHandlers, McpRouteOptions } from '../types.js'
import { normalizeBasePath, rewriteRequestPath } from './stripPrefix.js'

/**
 * Build the MCP route handlers for a single catch-all Next.js route file.
 *
 * Wires the actions through `@silkweave/vercel` (stateless MCP over Web Standard
 * Streamable HTTP) and wraps its handler with a prefix-stripping rewrite so the
 * transport, OAuth routes and protected-resource metadata all resolve from one
 * `app/<basePath>/[[...slug]]/route.ts` file.
 */
export function buildMcpRoute(
  identity: SilkweaveOptions,
  actions: readonly Action[],
  options: McpRouteOptions
): McpRouteHandlers {
  const basePath = normalizeBasePath(options.basePath)
  const { adapter, handler } = vercel({
    auth: options.auth,
    enableJsonResponse: options.enableJsonResponse
  })

  // Resolve the adapter's `_ready` promise. The handler awaits it internally, so
  // we don't need to await here - a floating start is safe and avoids forcing a
  // top-level `await` into the consumer's route module.
  void silkweave(identity).actions(actions).adapter(adapter).start()

  const route = (request: Request): Promise<Response> => handler(rewriteRequestPath(request, basePath))

  return { GET: route, POST: route, DELETE: route, OPTIONS: route }
}
