import { Action, silkweave, SilkweaveOptions } from '@silkweave/core'
import { trpcFetch } from '@silkweave/trpc'
import { NextRouteHandler, TrpcRouteHandlers, TrpcRouteOptions } from '../types.js'

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Max-Age': '86400'
}

function withCors(handler: NextRouteHandler): NextRouteHandler {
  return async (request) => {
    const response = await handler(request)
    const headers = new Headers(response.headers)
    for (const [key, value] of Object.entries(CORS_HEADERS)) { headers.set(key, value) }
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers })
  }
}

/**
 * Build the tRPC route handlers for a `[trpc]` Next.js route file.
 *
 * Wires the actions through `@silkweave/trpc`'s fetch handler. tRPC strips the
 * `endpoint` prefix itself, so no URL rewriting is needed. CORS is opt-in
 * (`options.cors`) since a Next.js frontend hitting its own `/api/trpc` is
 * same-origin.
 */
export function buildTrpcRoute(
  identity: SilkweaveOptions,
  actions: readonly Action[],
  options: TrpcRouteOptions
): TrpcRouteHandlers {
  const { adapter, GET, POST } = trpcFetch({ endpoint: options.endpoint, auth: options.auth })

  void silkweave(identity).actions(actions).adapter(adapter).start()

  const optionsHandler: NextRouteHandler = () =>
    Promise.resolve(new Response(null, { status: 204, headers: options.cors ? CORS_HEADERS : {} }))

  if (!options.cors) {
    return { GET, POST, OPTIONS: optionsHandler }
  }
  return { GET: withCors(GET), POST: withCors(POST), OPTIONS: optionsHandler }
}
