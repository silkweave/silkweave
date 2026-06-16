import { AuthConfig } from '@silkweave/auth'

/** A Next.js App Router route handler: receives a Web `Request`, returns a `Response`. */
export type NextRouteHandler = (request: Request) => Promise<Response>

/** Options for `app.mcp()` - mounts MCP Streamable HTTP under a catch-all route. */
export interface McpRouteOptions {
  /**
   * The URL prefix this route is mounted at - it MUST equal the route file's
   * directory. For `app/api/mcp/[[...mcp]]/route.ts` this is `'/api/mcp'`.
   *
   * The adapter strips this prefix from incoming requests so the MCP transport
   * (`/api/mcp`), OAuth routes (`/api/mcp/authorize`, `/api/mcp/token`, ...) and
   * the protected-resource metadata (`/api/mcp/.well-known/...`) all resolve
   * from this single catch-all file.
   */
  basePath: string
  /** Optional bearer-token / OAuth 2.1 configuration (see `@silkweave/auth`). */
  auth?: AuthConfig
  /** Return a single JSON response instead of an SSE stream when possible. */
  enableJsonResponse?: boolean
}

/** Options for `app.trpc()` - mounts a tRPC endpoint under a `[trpc]` route. */
export interface TrpcRouteOptions {
  /**
   * The tRPC endpoint prefix - it MUST equal the route file's directory minus
   * the `[trpc]` segment. For `app/api/trpc/[trpc]/route.ts` this is
   * `'/api/trpc'`. tRPC strips this prefix itself when routing procedures.
   */
  endpoint: string
  /** Optional bearer-token / OAuth 2.1 configuration (see `@silkweave/auth`). */
  auth?: AuthConfig
  /**
   * Add permissive CORS headers + an `OPTIONS` preflight handler. Default
   * `false` - a Next.js frontend calling its own `/api/trpc` is same-origin and
   * needs no CORS. Enable only for cross-origin tRPC clients.
   */
  cors?: boolean
}

/** Handlers to re-export from `app/api/mcp/[[...mcp]]/route.ts`. */
export interface McpRouteHandlers {
  GET: NextRouteHandler
  POST: NextRouteHandler
  DELETE: NextRouteHandler
  OPTIONS: NextRouteHandler
}

/** Handlers to re-export from `app/api/trpc/[trpc]/route.ts`. */
export interface TrpcRouteHandlers {
  GET: NextRouteHandler
  POST: NextRouteHandler
  OPTIONS: NextRouteHandler
}
