// Express server subpath - everything that depends on express/cors. Import
// `http()` and the mountable handlers (`mcpTransport`, `oauthRoutes`,
// `protectedResourceMetadata`, `sideloadResource`, `mcpCors`, `authMiddleware`)
// from here, not the package root. Keeping them off the root lets stdio-only and
// serverless (edge) consumers avoid installing express/cors.
export * from './adapter/http.js'
export * from './handlers/auth.js'
export * from './handlers/cors.js'
export * from './handlers/metadata.js'
export * from './handlers/oauth.js'
export * from './handlers/sideload.js'
export * from './handlers/transport.js'
// Re-exported for convenience so a server consumer gets FilterActions alongside
// the transport it configures (also available from the package root).
export * from './handlers/filter.js'

export type { CorsOptions } from 'cors'
