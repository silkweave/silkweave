import type { HttpAdapterHost } from '@nestjs/core'
import { AuthConfig } from '@silkweave/auth'
import type { Adapter, AdapterGenerator } from '@silkweave/core'
import { createMcpExpressHandler, type CreateMcpExpressHandlerOptions } from '@silkweave/mcp'
import { reserveSlot, type NodeMiddleware } from '../lib/slot.js'
import type { NestSilkweaveAdapter } from '../lib/types.js'

export interface McpAdapterOptions extends Omit<CreateMcpExpressHandlerOptions, 'auth'> {
  /** URL prefix at which the MCP sub-app is mounted. Default `'/'` — the MCP transport then lives at `/mcp`, OAuth routes at `/authorize`, etc. */
  basePath?: string
  /** Optional bearer-token / OAuth auth applied to MCP requests. Same shape as `@silkweave/mcp`'s `http()` auth. */
  auth?: AuthConfig
}

/**
 * MCP Streamable HTTP adapter for `@silkweave/nestjs`. Builds the same Express
 * sub-app that `@silkweave/mcp`'s `http()` adapter uses internally (via
 * `createMcpExpressHandler`) and mounts it on Nest's running HTTP server at
 * the configured base path.
 *
 * Routes provided by the mounted sub-app:
 * - `POST /mcp`, `GET /mcp`, `DELETE /mcp` — MCP Streamable HTTP transport
 * - `GET /resource/:id` — sideload resources (large MCP responses)
 * - `GET /.well-known/oauth-protected-resource` (when `auth.resourceUrl`/`auth.authorizationServers` set)
 * - `GET /authorize`, `POST /token`, `POST /register`, `GET /auth/callback` (when `auth.provider` set)
 *
 * Note: this adapter mounts an Express sub-app. On `@nestjs/platform-fastify`,
 * register `@fastify/express` before this adapter so Nest can serve Express
 * middleware.
 */
export function mcp(options: McpAdapterOptions = {}): NestSilkweaveAdapter {
  return {
    name: 'mcp',
    install: (host: HttpAdapterHost): AdapterGenerator => {
      const httpAdapter = host.httpAdapter
      if (!httpAdapter) {
        throw new Error('@silkweave/nestjs mcp(): HttpAdapterHost.httpAdapter is not available.')
      }
      const { basePath = '/', auth, ...handlerOptions } = options
      const mountPath = basePath === '/' ? '/' : basePath.replace(/\/$/, '')
      const setHandler = reserveSlot(httpAdapter as unknown as { use: (path: string, h: NodeMiddleware) => unknown }, mountPath, 'MCP')
      return (silkweaveOptions, baseContext): Adapter => {
        const context = baseContext.fork({ adapter: 'mcp' })
        return {
          context,
          start: async (actions) => {
            const app = createMcpExpressHandler(silkweaveOptions, context, actions, { ...handlerOptions, auth })
            setHandler(app as unknown as NodeMiddleware)
          },
          stop: async () => { /* Nest owns the HTTP server */ }
        }
      }
    }
  }
}
