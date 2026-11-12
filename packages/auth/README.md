# @silkweave/auth

Auth for [Silkweave](https://github.com/silkweave/silkweave) MCP servers, in two layers:

- **Resource-server core** (the package root, `@silkweave/auth`) - the spec-required surface for an MCP server: bearer-token validation + protected resource metadata (RFC 9728). `jose`-only. Most servers need only this and delegate token issuance to an external IdP (Auth0/WorkOS/Stytch/Keycloak/Google).
- **OAuth authorization server** (the opt-in subpath, `@silkweave/auth/oauth`) - a full OAuth 2.1 proxy between MCP clients and an upstream IdP: PKCE, refresh tokens, dynamic client registration (CIMD), and persistence stores. Import this only when you want Silkweave itself to *be* the authorization server, so a pure resource server never pulls the issuer machinery into its dependency graph.

## Install

```bash
pnpm add @silkweave/auth
```

> The OAuth-proxy helpers (`google`, `createOAuthProxy`, `createJsonStore`/`createRedisStore`/`createMemoryStore`, `OAuthStore`) are imported from `@silkweave/auth/oauth`. Bearer validation (`validateToken`) and `generateProtectedResourceMetadata` - plus the `AuthConfig`/`AuthInfo`/`OAuthRequest`/`OAuthResponse`/`OAuthProvider` types - live at the package root.

## Quick Start with Google OAuth

The `google()` helper returns a complete `AuthConfig` ready to pass to the `http()` adapter:

```typescript
import { google, createJsonStore } from '@silkweave/auth/oauth'
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
import { createOAuthProxy } from '@silkweave/auth/oauth'

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
| `signingKey` | `string \| Uint8Array` | random | Secret for signing JWTs (HS256). Random means tokens die with the process |
| `tokenTtl` | `number` | `3600` | Access token lifetime in seconds |
| `refreshTokenTtl` | `number` | 30 days | Absolute refresh-token lifetime; rotation never extends it |
| `refreshGraceSeconds` | `number` | `30` | How long a rotated refresh token is still honored (concurrent refresh); a replay after that revokes the grant |
| `store` | `OAuthStore` | memory | Store adapter for OAuth state |
| `allowedResources` | `AllowedResources` | -- | RFC 8707 indicators this AS mints an `aud` for (see Multi-resource) |
| `isGrantActive` | `(grant: GrantRef) => boolean \| Promise<boolean>` | -- | Per-call revocation check, run on every `verifyToken` and every refresh grant |

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

## Your app as the identity provider: `createOAuthServer()`

When your app already knows who the person is (a signed-in session, your own login page), there is no upstream IdP to proxy. `createOAuthServer()` is the same OAuth 2.1 authorization server - discovery, dynamic client registration, CIMD, PKCE, refresh rotation with replay detection, RFC 8707 resource indicators - but `/authorize` hands the browser to **your consent page** instead of an upstream IdP. MCP clients (Claude Code, Claude Desktop / claude.ai connectors, Codex) connect with just the server URL.

```typescript
import { createOAuthServer } from '@silkweave/auth/oauth'

const oauth = createOAuthServer({
  resourceUrl: 'https://app.example.com/mcp',
  redirectUris: ['http://localhost:*', 'http://127.0.0.1:*', 'https://claude.ai/*'],
  signingKey: process.env.OAUTH_SIGNING_KEY!,
  store,
  // /authorize validated the client request and stored it as pending: send the
  // browser to your consent page. Return a full OAuthResponse to also set a
  // cookie binding the request to this browser.
  onAuthorize: (pending) => `https://app.example.com/connect?request=${pending.id}`,
  // Revocation that applies immediately, on every call and every refresh.
  isGrantActive: async ({ grantId, sub }) => (await grants.isActive(grantId)) && (await users.isActive(sub))
})

// Consent page backend (signed-in session + CSRF protection):
const pending = await oauth.pending(id)            // client name, cimd/dcr, redirect host, scopes - for the page
const { redirectTo } = (await oauth.approve(id, { sub: user.id }))!   // or oauth.deny(id)
// -> the page navigates to redirectTo (code + state + iss); the client redeems the code at /token
```

Mount it like any provider (`auth.provider`, with `verifyToken: (t) => oauth.verifyToken(t)`). It has no callback endpoint - the decision arrives through `approve()` / `deny()`, which are **single use** and return `undefined` for an unknown, expired (10 minutes) or already-decided request. A runnable version (toy session + consent page) is `examples/mcp/src/http-local-oauth.ts`.

`OAuthServerConfig` takes every option in the `OAuthProxyConfig` table that is not upstream-specific (`resourceUrl`, `redirectUris`, `signingKey`, `tokenTtl`, `refreshTokenTtl`, `refreshGraceSeconds`, `store`, `allowedResources`, `isGrantActive`), plus:

| Option | Type | Description |
|--------|------|-------------|
| `onAuthorize` | `(pending: PendingAuthorization, req) => string \| OAuthResponse` | Where to send the browser after `/authorize` validated the request |
| `scopesSupported` | `string[]` | Advertised as `scopes_supported` |

**Consent page checklist** (the package cannot do these for you): render `clientName` escaped - it is self-asserted even for CIMD clients - and show the verified identity instead: `clientHost` (the host serving a CIMD client's metadata document, e.g. `claude.ai`) or, for `clientKind: 'dcr'` clients, an "unverified" label plus `redirectHost`; reject requested `scopes` the person may not grant before calling `approve()` (`scopesSupported` is metadata only - the requested scopes are minted as asked); send `Content-Security-Policy: frame-ancestors 'none'` (an Allow button must not be clickjackable), only approve from a signed-in browser session behind CSRF protection (never from a bearer token), and bind the pending request to the browser that opened it.

### Grants, tokens and revocation

Every redeemed approval is a **grant** with a stable `grantId`, kept across refresh-token rotation. The id is minted when the client redeems the authorization code (not inside `approve()`), and it reaches your store as `RefreshTokenData.grantId` (with `sub`, `clientId`, `createdAt`) in the first `saveRefreshToken` call for it - that is where a "Connected apps" store records a new grant row. Access tokens carry `sub` (the person), `client_id` (the OAuth client) and `grant_id`; `verifyToken` returns them as `AuthInfo.sub`, `AuthInfo.oauthClientId` and `AuthInfo.grantId`. (`AuthInfo.clientId` keeps its historical meaning - the token subject - for compatibility.)

- **Refresh rotation:** every refresh returns a new refresh token; the old one is kept, marked `rotatedAt`, with its successor sealed under the old token (`next`, AES-GCM with a key derived from the raw old token - unreadable to the store). Reusing the old token within `refreshGraceSeconds` (30s) returns the **same** successor (clients refreshing concurrently) - every presenter continues one chain, so a thief and the legitimate client collide at the next rotation. Reusing it after the window is treated as theft and the whole grant is revoked (RFC 9700 §4.14.2). The first rotation is a compare-and-set, so parallel refreshes cannot fork the chain either.
- **Revocation:** `store.revokeGrant(grantId)` records a durable tombstone and deletes the grant's tokens; every refresh checks the tombstone first and again after saving its successor, so an in-flight refresh cannot resurrect a revoked grant. Have `isGrantActive` return `false` too - the hook runs on every `verifyToken` and every refresh, so the current access token stops working immediately instead of at `exp`. While `isGrantActive` is set, tokens without a grant id (minted before 7.2) are rejected.
- Listing a person's connections ("Connected apps") is a store concern: index `RefreshTokenData.grantId` / `sub` / `clientId` / `createdAt` in your store.

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

### Recommended: front with an external IdP (resource-server only)

The MCP 2026 spec direction is for servers to be **pure OAuth resource servers**
that delegate token issuance to a dedicated authorization server. For most
deployments, point `authorizationServers` at an external IdP (Auth0, WorkOS,
Stytch, Keycloak, Google, ...), have `verifyToken` validate that IdP's JWTs (e.g.
with `jose`'s `jwtVerify` against the IdP JWKS), and skip the `@silkweave/auth/oauth`
proxy entirely:

```typescript
import { validateToken } from '@silkweave/auth'

const auth = {
  resourceUrl: 'https://mcp.example.com',
  authorizationServers: ['https://idp.example.com'],
  issuer: 'https://idp.example.com',     // RFC 9207 - bind the token to this issuer
  audience: 'https://mcp.example.com',   // RFC 8707 - reject tokens minted for another resource
  requiredScopes: ['mcp:tools'],         // advertised in the 403 step-up challenge (SEP-2350)
  verifyToken: async (token) => {
    const { payload } = await jwtVerify(token, JWKS, { issuer: 'https://idp.example.com', audience: 'https://mcp.example.com' })
    return { token, clientId: payload.sub, scopes: String(payload.scope ?? '').split(' '), iss: payload.iss, aud: payload.aud, expiresAt: payload.exp }
  }
}
```

`validateToken` then enforces, in order: expiry, **issuer** binding (`issuer`),
**audience** binding (`audience`, defaults to `resourceUrl`; set `false` to skip),
and **required scopes** - emitting a `WWW-Authenticate` challenge with `scope="..."`
on insufficient scope so the client knows what to step up to.

## Protected Resource Metadata (RFC 9728)

Generate the `/.well-known/oauth-protected-resource` document for your server:

```typescript
import { generateProtectedResourceMetadata } from '@silkweave/auth'

const metadata = generateProtectedResourceMetadata(
  'https://my-server.example.com',
  ['https://idp.example.com'],
  ['mcp:tools'] // optional scopes_supported - the adapters pass auth.requiredScopes here
)
// {
//   resource: 'https://my-server.example.com',
//   authorization_servers: ['https://idp.example.com'],
//   scopes_supported: ['mcp:tools'],
//   bearer_methods_supported: ['header']
// }
```

## Multi-resource: one authorization server, N protected resources

A server fronting several tenants needs a distinct URL per tenant (Claude Desktop and
claude.ai dedupe MCP connectors by URL), and each URL must be its own OAuth **protected
resource** with its own token audience - so a token minted for tenant A is rejected when
replayed against tenant B. There is still exactly one authorization server.

Set `resourceUrl` to a **resolver** instead of a string, and give the authorization server
an allow-list of the resource indicators it will mint an `aud` for:

```typescript
import { createOAuthProxy } from '@silkweave/auth/oauth'
import { pathResolver, type AuthConfig } from '@silkweave/auth'

const AS = 'https://mcp.example.com'
const TENANT = /^\/([a-z]{8})$/

const provider = createOAuthProxy({
  authorizeUrl, tokenUrl, clientId, clientSecret,
  resourceUrl: AS,              // AS identity: iss + endpoint base + default audience
  redirectUris, signingKey, store,
  // The allow-list is the AS's, never the client's.
  allowedResources: async (resource) => {
    const { origin, pathname } = new URL(resource)
    const match = TENANT.exec(pathname)
    return origin === AS && !!match && await spaceExists(match[1])
  }
})

const auth: AuthConfig = {
  verifyToken: (token) => provider.verifyToken(token),
  provider,
  authorizationServers: [AS],
  // Canonical by construction: identifiers are built from `origin`, never from
  // the inbound request's origin, so a spoofed Host cannot steer the advertised
  // metadata URL or the expected audience.
  resourceUrl: pathResolver({ origin: AS, match: TENANT })
}
```

On the wire: an unauthorized `POST https://mcp.example.com/yoexoexl` is challenged with
`resource_metadata="https://mcp.example.com/.well-known/oauth-protected-resource/yoexoexl"`
(RFC 9728 path-insertion form, which is what the MCP SDK probes); that document advertises
`resource: https://mcp.example.com/yoexoexl` and the shared `authorization_servers`; the
client sends `resource=…/yoexoexl` on both the authorize and token legs; the minted token
carries that `aud`; presenting it at `/kqwrmach` is a 401.

| `allowedResources` | client `resource` | minted `aud` |
|---|---|---|
| unset | absent | `resourceUrl` |
| unset | anything | `resourceUrl` - the indicator is ignored (pre-5.1 behavior) |
| set | absent | `resourceUrl` (the default resource) |
| set | allowed value | that value, normalized |
| set | anything else | `invalid_target`, no token |

Notes that matter:

- **`aud` is not membership.** The AS mints `aud: …/tenantA` for any authenticated upstream
  user who asks, including one with no rights in tenant A. The indicator says where a token
  may be *presented*, never what its subject may *do* there. Per-tenant authorization stays
  your job on every call - treating "aud matches my tenant" as an access grant is a privilege
  escalation. `validateToken` returns the resolved `resource` so you have the tenant identity
  without re-parsing the URL.
- **Shape vs. existence.** The resolver is synchronous *shape* mapping, so it serves a metadata
  document for any tenant-shaped path - including one that does not exist. Existence is the
  authorization server's job, asynchronously, in `allowedResources`: an unknown-but-shaped tenant
  gets a document but can never get a token. That leaks nothing beyond the id shape; for
  existence-accurate metadata, have the resolver consult a synchronous cache of live tenants.
- **A resolver returning `undefined`** behaves exactly as an unset `resourceUrl`: a challenge
  without `resource_metadata` and no default audience check (an explicit `audience` still
  applies). This keeps guarded non-resource routes such as sideload `/resource/:id` working.
- **Refresh is not a pivot.** The audience rides the refresh-token record and is re-minted
  verbatim on rotation; a `resource` on the refresh request that differs is `invalid_target`.
- **One resource per grant.** Repeated `resource` parameters are rejected rather than silently
  using the first.
- A predicate `allowedResources` runs on every `verifyToken`, so a store-backed check is a hit
  per bearer validation - cache it, and note the store's availability becomes the token path's.

Adapters mount the wildcard well-known route automatically when `resourceUrl` is a resolver.
Existing string configs are unchanged in every respect, including the append-form challenge URL.

## Store Adapters

The OAuth proxy needs persistent storage for auth codes, client registrations, PKCE verifiers, and refresh tokens. Three built-in adapters are available:

### Memory (default)

In-memory storage -- data is lost on restart. Good for development:

```typescript
import { createMemoryStore } from '@silkweave/auth/oauth'

const store = createMemoryStore()
```

### JSON File

Persists to a JSON file on disk. Suitable for single-process deployments:

```typescript
import { createJsonStore } from '@silkweave/auth/oauth'

const store = createJsonStore('oauth-store.json')
```

### Redis

For production multi-process deployments. Accepts any Redis client with `get`/`set`/`del` (Upstash's client fits as-is; wrap `ioredis`/`redis` in a small adapter). For the atomic guarantees the adapter must honor `set(key, value, { nx: true })` (return `null` when the key exists) and should provide `getdel` (Redis >= 6.2); without them single-use codes/consent and refresh rotation degrade to get-then-write:

```typescript
import { createRedisStore } from '@silkweave/auth/oauth'
import Redis from 'ioredis'

const store = createRedisStore({
  client: new Redis(),
  prefix: 'silkweave:oauth:'  // default prefix
})
```

### Custom Store

Implement the `OAuthStore` interface for your own backend:

```typescript
import type { OAuthStore } from '@silkweave/auth/oauth'

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
  deleteRefreshToken(token) { /* ... */ },
  // Optional, strongly recommended (a warning is logged when any is missing):
  revokeGrant(grantId) { /* tombstone FIRST, then delete every refresh token of the grant */ },
  isGrantRevoked(grantId) { /* is there a tombstone? */ },
  takeAuthCode(code) { /* atomic get + delete, e.g. DELETE ... RETURNING */ },
  takePendingAuth(state) { /* atomic get + delete */ },
  rotateRefreshToken(token, rotation) { /* set rotatedAt/next/grantId only if not yet rotated; return the stored record */ }
}
```

Refresh-token semantics: rotation records `rotatedAt`, `next` (the sealed successor, opaque) and `grantId` on the **presented** token's record (keeping its original `expiresAt`), so `getRefreshToken(old)` must keep returning that record for grace reuse and replay detection. A store that cannot keep it may return `undefined` - a replay then simply fails, without revoking the grant. Persist `next` verbatim; it is ciphertext only the holder of the old token can open.

The atomic methods matter under concurrency: without them two parallel redemptions of one code, two approvals of one consent request, or two first refreshes of one token can each succeed. The built-in memory and JSON stores are atomic within one process; the Redis store is atomic across processes when the client honors `nx`/`getdel`. Retained rotation records expire at their chain's absolute expiry (the memory and JSON stores sweep expired records on save).

## How It Works

The OAuth proxy sits between MCP clients and the upstream identity provider:

1. MCP client calls `/authorize` -- the proxy generates its own PKCE pair and redirects to the upstream provider
2. User authenticates with the upstream provider (e.g., Google)
3. Upstream redirects back to the proxy's callback path with an authorization code
4. Proxy exchanges the upstream code for tokens, then issues its own authorization code to the MCP client
5. MCP client exchanges that code at `/token` (with PKCE verification) and receives a signed JWT access token + refresh token
6. Subsequent requests include the JWT as a Bearer token, verified locally via `jose`

Both `createOAuthProxy()` and `createOAuthServer()` also support:
- **Dynamic client registration** at `/register` (RFC 7591). Every client is public (PKCE, `token_endpoint_auth_method: 'none'`) - no client secret is minted
- **Client ID Metadata Documents (CIMD)** -- clients with HTTPS URLs as `client_id` are auto-registered by fetching their metadata document, which must name itself (`client_id` equal to its URL)
- **Loopback redirects on any port** (RFC 8252 §7.3) -- a registered `http://127.0.0.1:4100/callback` also matches `:5999`; host, path and query must still match exactly
- **RFC 9207 `iss`** in every authorization response (code or error)
- **Refresh tokens** with a 30-day absolute expiry, rotated on every use, with replay detection

## See Also

- [Silkweave README](https://github.com/silkweave/silkweave) -- Full documentation
- [`@silkweave/core`](https://www.npmjs.com/package/@silkweave/core) -- Core library
- [`@silkweave/mcp`](https://www.npmjs.com/package/@silkweave/mcp) -- MCP stdio and HTTP adapters
