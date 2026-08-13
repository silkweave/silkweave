import cors, { CorsOptions } from 'cors'
import { type RequestHandler } from 'express'

/** Headers required by the MCP protocol that must always be exposed when CORS is in use. */
export const MCP_REQUIRED_HEADERS = ['WWW-Authenticate', 'Last-Event-Id', 'Mcp-Protocol-Version']

/**
 * CORS middleware preconfigured to expose the headers MCP clients need
 * (`Last-Event-Id`, `Mcp-Protocol-Version`, `WWW-Authenticate`) on top of any
 * user-supplied options. (Stateless transport - no `Mcp-Session-Id`.)
 *
 * Pass `false` to disable, omit / pass `true` for permissive defaults, or pass
 * a `CorsOptions` object to override.
 */
export function mcpCors(corsConfig: CorsOptions | boolean = true): RequestHandler | null {
  if (corsConfig === false) {
    return null
  }
  const userConfig = corsConfig === true ? {} : corsConfig
  const userExposed = userConfig.exposedHeaders
  const exposedHeaders = [
    ...MCP_REQUIRED_HEADERS,
    ...(Array.isArray(userExposed) ? userExposed : userExposed ? [userExposed] : [])
  ]
  return cors({ origin: '*', ...userConfig, exposedHeaders })
}
