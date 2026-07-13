import { Action, silkweave, SilkweaveOptions } from '@silkweave/core'
import { edge } from '@silkweave/edge'
import { McpRouteHandlers, McpRouteOptions } from '../types.js'
import { normalizeBasePath, rewriteRequestPath } from './stripPrefix.js'

/**
 * Build the MCP route handlers for a single catch-all Next.js route file.
 *
 * Wires the actions through `@silkweave/edge` (stateless MCP over Web Standard
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
  const { adapter, handler } = edge({
    auth: options.auth,
    enableJsonResponse: options.enableJsonResponse
  })

  // Kick off the adapter's `_ready` promise (the handler awaits it internally).
  // We don't await here - that would force a top-level `await` into the route
  // module - but we MUST catch: an unhandled start() rejection (e.g. an invalid
  // `disposition: 'structured'` action) would otherwise crash the Next server.
  // On boot failure edge()'s `_ready` rejects, so requests get a 500, not a hang.
  silkweave(identity).actions(actions).adapter(adapter).start().catch((error: unknown) => {
    console.error('[silkweave/nextjs] MCP adapter failed to start:', error)
  })

  const route = (request: Request): Promise<Response> => handler(rewriteRequestPath(request, basePath))

  return { GET: route, POST: route, DELETE: route, OPTIONS: route }
}
