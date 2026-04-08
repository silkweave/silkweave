# @silkweave/auth

OAuth 2.1 authentication for [Silkweave](https://github.com/atomicbi/silkweave) MCP servers. Acts as an OAuth proxy between MCP clients and upstream identity providers (Google, etc.), handling PKCE, refresh tokens, dynamic client registration (CIMD), and protected resource metadata (RFC 9728).

Standalone package -- only depends on `jose` for JWT signing/verification.

## Install

```bash
pnpm add @silkweave/auth
```

## Quick Start with Google OAuth

The `google()` helper returns a complete `AuthConfig` ready to pass to the `http()` adapter:

```typescript
import { google, createJsonStore } from '@silkweave/auth'
import { silkweave } from '@silkweave/core'
import { http } from '@silkweave/mcp'

const auth = google({
  clientId: process.env.GOOGLE_CLIENT_ID!,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
  resourceUrl: 'http://localhost:8080',
  redirectUris: ['http://localhost:*', 'https://claude.ai/*'],
  requiredScopes: ['openid', 'https://www.googleapis.com/auth/userinfo.email'],
  signingKey: 'your-signing-secret',
  store: createJsonStore('oauth-store.json')
})

await silkweave({ name: 'my-server', description: 'My MCP Server', version: '1.0.0' })
  .adapter(http({ host: 'localhost', port: 8080, auth }))
  .action(MyAction)
  .start()
```

### `GoogleOAuthOptions`

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `clientId` | `string` | -- | Google OAuth client ID |
| `clientSecret` | `string` | -- | Google OAuth client secret |
| `resourceUrl` | `string` | -- | Public URL of your MCP server |
| `redirectUris` | `string[]` | -- | Allowed redirect URI patterns (supports `*` wildcards) |
| `requiredScopes` | `string[]` | `['openid', 'email']` | Scopes to request from Google |
| `callbackPath` | `string` | `'/auth/callback'` | Path for the OAuth callback endpoint |
| `signingKey` | `string` | random | Secret for signing JWTs (random per-process if omitted) |
| `tokenTtl` | `number` | `3600` | Access token lifetime in seconds |
| `store` | `OAuthStore` | memory | Store adapter for OAuth state |

## Custom Providers with `createOAuthProxy()`

For providers other than Google, use `createOAuthProxy()` directly. It returns an `OAuthProvider` that implements the full OAuth 2.1 proxy flow:

```typescript
import { createOAuthProxy } from '@silkweave/auth'

const provider = createOAuthProxy({
  authorizeUrl: 'https://provider.example.com/authorize',
  tokenUrl: 'https://provider.example.com/token',
  userinfoUrl: 'https://provider.example.com/userinfo',
  clientId: process.env.OAUTH_CLIENT_ID!,
  clientSecret: process.env.OAUTH_CLIENT_SECRET!,
  resourceUrl: 'https://my-server.example.com',
  redirectUris: ['https://claude.ai/*'],
  requiredScopes: ['openid', 'email']
})
```

### `OAuthProxyConfig`

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `authorizeUrl` | `string` | -- | Upstream authorization endpoint |
| `tokenUrl` | `string` | -- | Upstream token endpoint |
| `userinfoUrl` | `string` | -- | Upstream userinfo endpoint (optional, best-effort) |
| `clientId` | `string` | -- | Your client ID with the upstream provider |
| `clientSecret` | `string` | -- | Your client secret with the upstream provider |
| `resourceUrl` | `string` | -- | Public URL of your MCP server |
| `redirectUris` | `string[]` | -- | Allowed redirect URI patterns |
| `requiredScopes` | `string[]` | `[]` | Scopes to request upstream |
| `callbackPath` | `string` | `'/auth/callback'` | Path for the OAuth callback endpoint |
| `signingKey` | `string` | random | Secret for signing JWTs |
| `tokenTtl` | `number` | `3600` | Access token lifetime in seconds |
| `store` | `OAuthStore` | memory | Store adapter for OAuth state |

### `OAuthProvider` interface

The provider returned by `createOAuthProxy()` exposes:

```typescript
interface OAuthProvider {
  metadata(): OAuthResponse
  register(req: OAuthRequest): Promise<OAuthResponse>
  authorize(req: OAuthRequest): Promise<OAuthResponse>
  callback(req: OAuthRequest): Promise<OAuthResponse>
  token(req: OAuthRequest): Promise<OAuthResponse>
  verifyToken(token: string): Promise<AuthInfo | undefined>
}
```

To build a full `AuthConfig` from a custom provider:

```typescript
const auth: AuthConfig = {
  verifyToken: (token) => provider.verifyToken(token),
  required: true,
  resourceUrl: 'https://my-server.example.com',
  authorizationServers: ['https://my-server.example.com'],
  provider
}
```

## Token Validation

Use `validateToken()` to verify bearer tokens in your own middleware or custom adapters:

```typescript
import { validateToken } from '@silkweave/auth'

const result = await validateToken(request.headers.authorization, {
  verifyToken: async (token) => {
    // Your verification logic -- return AuthInfo or undefined
    return { token, clientId: 'user-123', scopes: ['read'] }
  },
  required: true,
  resourceUrl: 'https://my-server.example.com',
  requiredScopes: ['read']
})

if (result.error) {
  // result.error.statusCode, result.error.headers, result.error.body
  return new Response(JSON.stringify(result.error.body), {
    status: result.error.statusCode,
    headers: result.error.headers
  })
}

// result.auth contains the verified AuthInfo
console.log(result.auth?.clientId)
```

## Protected Resource Metadata (RFC 9728)

Generate the `/.well-known/oauth-protected-resource` document for your server:

```typescript
import { generateProtectedResourceMetadata } from '@silkweave/auth'

const metadata = generateProtectedResourceMetadata(
  'https://my-server.example.com',
  ['https://my-server.example.com']
)
// {
//   resource: 'https://my-server.example.com',
//   authorization_servers: ['https://my-server.example.com'],
//   bearer_methods_supported: ['header']
// }
```

## Store Adapters

The OAuth proxy needs persistent storage for auth codes, client registrations, PKCE verifiers, and refresh tokens. Three built-in adapters are available:

### Memory (default)

In-memory storage -- data is lost on restart. Good for development:

```typescript
import { createMemoryStore } from '@silkweave/auth'

const store = createMemoryStore()
```

### JSON File

Persists to a JSON file on disk. Suitable for single-process deployments:

```typescript
import { createJsonStore } from '@silkweave/auth'

const store = createJsonStore('oauth-store.json')
```

### Redis

For production multi-process deployments. Accepts any Redis client with `get`/`set`/`del` methods (compatible with `ioredis` and `redis`):

```typescript
import { createRedisStore } from '@silkweave/auth'
import Redis from 'ioredis'

const store = createRedisStore({
  client: new Redis(),
  prefix: 'silkweave:oauth:'  // default prefix
})
```

### Custom Store

Implement the `OAuthStore` interface for your own backend:

```typescript
import type { OAuthStore } from '@silkweave/auth'

const store: OAuthStore = {
  saveAuthCode(code, data) { /* ... */ },
  getAuthCode(code) { /* ... */ },
  deleteAuthCode(code) { /* ... */ },
  savePendingAuth(state, data) { /* ... */ },
  getPendingAuth(state) { /* ... */ },
  deletePendingAuth(state) { /* ... */ },
  savePkceVerifier(state, verifier) { /* ... */ },
  getPkceVerifier(state) { /* ... */ },
  deletePkceVerifier(state) { /* ... */ },
  saveClient(clientId, data) { /* ... */ },
  getClient(clientId) { /* ... */ },
  saveRefreshToken(token, data) { /* ... */ },
  getRefreshToken(token) { /* ... */ },
  deleteRefreshToken(token) { /* ... */ }
}
```

## How It Works

The OAuth proxy sits between MCP clients and the upstream identity provider:

1. MCP client calls `/authorize` -- the proxy generates its own PKCE pair and redirects to the upstream provider
2. User authenticates with the upstream provider (e.g., Google)
3. Upstream redirects back to the proxy's callback path with an authorization code
4. Proxy exchanges the upstream code for tokens, then issues its own authorization code to the MCP client
5. MCP client exchanges that code at `/token` (with PKCE verification) and receives a signed JWT access token + refresh token
6. Subsequent requests include the JWT as a Bearer token, verified locally via `jose`

The proxy also supports:
- **Dynamic client registration** at `/register` (RFC 7591)
- **Client Information Metadata Documents (CIMD)** -- clients with HTTPS URLs as `client_id` are auto-registered by fetching their metadata document
- **Refresh tokens** with 30-day expiry for long-lived sessions

## See Also

- [Silkweave README](https://github.com/atomicbi/silkweave) -- Full documentation
- [`@silkweave/core`](https://www.npmjs.com/package/@silkweave/core) -- Core library
- [`@silkweave/mcp`](https://www.npmjs.com/package/@silkweave/mcp) -- MCP stdio and HTTP adapters
