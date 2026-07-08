// Dedicated entry for the MCP CLI proxy client. Kept out of the package root
// (`@silkweave/mcp`) so importing the stdio/http servers does not pull the CLI
// client's `commander` dep into the server path.
export * from './adapter/cliProxy.js'
