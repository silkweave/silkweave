// Resource-server core (spec-required, jose-only): bearer-token validation +
// RFC 9728 protected-resource metadata. The OAuth 2.1 authorization-server proxy
// (token issuance, PKCE, refresh, CIMD, DCR) + its stores live behind the opt-in
// `@silkweave/auth/oauth` subpath so they never enter a resource-server's graph.
// The OAuth *types* (OAuthRequest/OAuthResponse/OAuthProvider) stay here because
// `AuthConfig.provider` references them and REST/MCP adapters type against them.
export * from './errors.js'
export * from './extract.js'
export * from './metadata.js'
export * from './types.js'
export * from './validate.js'
export type { OAuthProvider, OAuthRequest, OAuthResponse } from './provider/types.js'
