// Root entry - the transport-neutral controller-reflection core. Importing it
// pulls in only `@silkweave/core` + zod (no MCP SDK, no @trpc/server), so an app
// pays only for the adapters it imports from the subpaths:
//   import { mcp } from '@silkweave/nestjs/mcp'
//   import { trpc } from '@silkweave/nestjs/trpc'
//   import { typegen } from '@silkweave/nestjs/typegen'
export * from './decorator/mcp.js'
export * from './decorator/trpc.js'
export * from './lib/controllerDiscovery.js'
export * from './lib/guards.js'
export * from './lib/metadata.js'
export * from './lib/rebind.js'
export * from './lib/silkweave.module.js'
export * from './lib/types.js'
export * from './lib/reflect/openapi.js'
export * from './lib/reflect/schema.js'
