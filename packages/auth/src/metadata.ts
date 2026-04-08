export interface ProtectedResourceMetadata {
  resource: string
  authorization_servers: string[]
  scopes_supported?: string[]
  bearer_methods_supported?: string[]
}

export function generateProtectedResourceMetadata(
  resourceUrl: string,
  authorizationServers: string[]
): ProtectedResourceMetadata {
  return {
    resource: resourceUrl,
    authorization_servers: authorizationServers,
    bearer_methods_supported: ['header']
  }
}
