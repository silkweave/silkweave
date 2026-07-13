// Express-free entry: the transport-agnostic MCP pieces shared by every adapter
// (tool registration + result formatting), with no `express`/`cors` in the import
// graph. Web-standard / serverless adapters (`@silkweave/edge`, `@silkweave/nextjs`)
// import from here so they never pull the Express HTTP server into their bundle or
// their install. The Express-based `http()` server lives at the package root.
export * from './handlers/filter.js'
export * from './handlers/registerTools.js'
export * from './util/result.js'
