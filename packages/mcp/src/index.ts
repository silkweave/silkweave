// Root entry - express-free surface only. The Express `http()` server and its
// handlers (transport, OAuth, CORS, sideload route, auth middleware) live behind
// the `@silkweave/mcp/server` subpath, so a stdio-only or serverless consumer
// never pulls express/cors into its graph.
export * from './adapter/stdio.js'
export * from './handlers/filter.js'
export * from './handlers/prevalidate.js'
export * from './handlers/registerTools.js'
export * from './util/result.js'
export * from './util/sideload.js'
